import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../db/client";
import { documents, documentTypes, extractions, records, webhookDeliveries } from "../db/schema";
import { deliverWebhook, markDeliveryFailed, WebhookDeliveryError } from "./deliver";
import {
  checkWebhookUrl,
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
} from "./endpoints";
import {
  dispatchDeliveries,
  pingWebhookEndpoint,
  recordApprovedDeliveries,
  requeuePendingDeliveries,
} from "./events";
import type { WebhookQueue } from "./queue";
import { verifyWebhookSignature } from "./signature";

const testUrl = process.env.TEST_DATABASE_URL;

describe("checkWebhookUrl", () => {
  it("accepts http and https, normalised", () => {
    expect(checkWebhookUrl(" https://example.com/hook ")).toBe("https://example.com/hook");
    expect(checkWebhookUrl("http://receiver:4000")).toBe("http://receiver:4000/");
  });

  it.each([
    [undefined, /Give the endpoint as "url"/],
    ["  ", /Give the endpoint as "url"/],
    ["not a url", /is not a URL/],
    ["file:///etc/passwd", /must use http or https/],
    ["ftp://example.com", /must use http or https/],
  ])("refuses %j", (url, message) => {
    expect(() => checkWebhookUrl(url)).toThrow(message);
  });
});

describe.skipIf(!testUrl)("webhooks", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const queue = { addBulk: vi.fn() };
  const fakeQueue = queue as unknown as WebhookQueue;
  let server: Server | undefined;
  let received: { headers: Record<string, unknown>; body: string }[] = [];

  /** A receiver answering with `status`, after `delayMs` */
  async function receiver(status: number, delayMs = 0): Promise<string> {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        received.push({ headers: request.headers, body });
        setTimeout(() => response.writeHead(status).end(), delayMs);
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/hook`;
  }

  async function approvedRecord(): Promise<string> {
    const [type] = await db
      .insert(documentTypes)
      .values({ slug: "uk-energy-bill", name: "UK business energy bill", version: 1, schema: {} })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: type?.id ?? "",
        storageKey: "k",
        originalFilename: "march.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        status: "approved",
      })
      .returning();
    const [extraction] = await db
      .insert(extractions)
      .values({
        documentId: document?.id ?? "",
        model: "m",
        promptVersion: "text-v2",
        runNumber: 1,
        rawOutput: "{}",
        durationMs: 1,
      })
      .returning();
    const [record] = await db
      .insert(records)
      .values({
        documentId: document?.id ?? "",
        extractionId: extraction?.id ?? "",
        documentTypeId: type?.id ?? "",
        data: { total_gbp: 386.88 },
        approvedBy: "admin",
      })
      .returning();
    return record?.id ?? "";
  }

  beforeEach(async () => {
    received = [];
    queue.addBulk.mockReset();
    await db.execute(
      sql`truncate webhook_deliveries, webhook_endpoints, corrections, records, extractions, documents, document_types restart identity cascade`,
    );
  });

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  afterAll(async () => {
    await close();
  });

  it("creates an endpoint with a fresh secret, and lists it without the secret", async () => {
    const created = await createWebhookEndpoint(db, {
      url: "https://example.com/hook",
      description: " Accounts ",
    });
    const other = await createWebhookEndpoint(db, { url: "https://example.com/b", description: 3 });

    expect(created).toMatchObject({
      url: "https://example.com/hook",
      description: "Accounts",
      active: true,
    });
    expect(created.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(other.secret).not.toBe(created.secret);
    expect(other.description).toBeNull();

    const listed = await listWebhookEndpoints(db);
    expect(listed.map((e) => e.id)).toEqual([other.id, created.id]);
    expect(listed[0]).not.toHaveProperty("secret");
    expect(listed[0]?.deliveries).toEqual({ pending: 0, delivered: 0, failed: 0 });
  });

  it("writes one delivery per active endpoint for an approval, carrying the record", async () => {
    const live = await createWebhookEndpoint(db, { url: "https://example.com/a" });
    const off = await createWebhookEndpoint(db, { url: "https://example.com/b" });
    await deactivateWebhookEndpoint(db, off.id);
    const recordId = await approvedRecord();

    const ids = await recordApprovedDeliveries(db, recordId);

    expect(ids).toHaveLength(1);
    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery).toMatchObject({
      endpointId: live.id,
      event: "record.approved",
      status: "pending",
    });
    expect(delivery?.payload).toMatchObject({
      type: "record.approved",
      data: {
        record: {
          id: recordId,
          filename: "march.pdf",
          document_type: { slug: "uk-energy-bill" },
          data: { total_gbp: 386.88 },
          approved_by: "admin",
        },
      },
    });

    await dispatchDeliveries(fakeQueue, ids);
    expect(queue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: { deliveryId: ids[0] },
        opts: expect.objectContaining({ jobId: ids[0], attempts: 8 }) as unknown,
      }),
    ]);
  });

  it("writes nothing without endpoints or record, and dispatches nothing without a queue", async () => {
    const recordId = await approvedRecord();
    expect(await recordApprovedDeliveries(db, recordId)).toEqual([]);

    await createWebhookEndpoint(db, { url: "https://example.com/a" });
    expect(await recordApprovedDeliveries(db, "00000000-0000-0000-0000-000000000000")).toEqual([]);

    await dispatchDeliveries(undefined, ["x"]);
    await dispatchDeliveries(fakeQueue, []);
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it("delivers a signed POST and logs it", async () => {
    const url = await receiver(204);
    const endpoint = await createWebhookEndpoint(db, { url });
    const [id] = await recordApprovedDeliveries(db, await approvedRecord());

    expect(await deliverWebhook(db, id ?? "")).toBe("delivered");

    const [request] = received;
    expect(request?.headers).toMatchObject({
      "content-type": "application/json",
      "echdyn-event": "record.approved",
      "echdyn-delivery": id,
    });
    expect(
      verifyWebhookSignature(
        endpoint.secret,
        String(request?.headers["echdyn-signature"]),
        request?.body ?? "",
      ),
    ).toBe(true);
    const [row] = await db.select().from(webhookDeliveries);
    expect(row).toMatchObject({
      status: "delivered",
      attempts: 1,
      lastStatusCode: 204,
      lastError: null,
    });
    expect(row?.deliveredAt).toBeInstanceOf(Date);

    // A retried job finds it delivered and sends nothing more
    expect(await deliverWebhook(db, id ?? "")).toBe("skipped");
    expect(received).toHaveLength(1);
  });

  it("throws for retry on an error status, logging each attempt", async () => {
    await createWebhookEndpoint(db, { url: await receiver(500) });
    const [id] = await recordApprovedDeliveries(db, await approvedRecord());

    await expect(deliverWebhook(db, id ?? "")).rejects.toThrow(WebhookDeliveryError);
    await expect(deliverWebhook(db, id ?? "")).rejects.toThrow("Responded 500");

    const [row] = await db.select().from(webhookDeliveries);
    expect(row).toMatchObject({
      status: "pending",
      attempts: 2,
      lastStatusCode: 500,
      lastError: "Responded 500",
    });
  });

  it("logs why an unreachable receiver failed", async () => {
    // A port that was just listening and is now closed refuses the connection
    const url = await receiver(200);
    await new Promise<void>((resolve) => {
      server?.close(() => {
        resolve();
      });
    });
    await createWebhookEndpoint(db, { url });
    const [id] = await recordApprovedDeliveries(db, await approvedRecord());

    await expect(deliverWebhook(db, id ?? "")).rejects.toThrow(/fetch failed/);

    const [row] = await db.select().from(webhookDeliveries);
    expect(row?.lastStatusCode).toBeNull();
    expect(row?.lastError).toMatch(/fetch failed: .*ECONNREFUSED/);
  });

  it("gives up on a receiver slower than the timeout", async () => {
    await createWebhookEndpoint(db, { url: await receiver(200, 500) });
    const [id] = await recordApprovedDeliveries(db, await approvedRecord());

    await expect(deliverWebhook(db, id ?? "", { timeoutMs: 50 })).rejects.toThrow("Timed out");
  });

  it("fails a delivery whose endpoint was deactivated, and marks the last retry failed", async () => {
    const endpoint = await createWebhookEndpoint(db, { url: "https://example.com/a" });
    const recordId = await approvedRecord();
    const [first, second] = [
      ...(await recordApprovedDeliveries(db, recordId)),
      ...(await recordApprovedDeliveries(db, recordId)),
    ];
    await deactivateWebhookEndpoint(db, endpoint.id);

    expect(await deliverWebhook(db, first ?? "")).toBe("skipped");
    await markDeliveryFailed(db, second ?? "");

    const rows = await db.select().from(webhookDeliveries);
    expect(rows.map((r) => [r.status, r.lastError])).toEqual(
      expect.arrayContaining([
        ["failed", "Endpoint deactivated"],
        ["failed", null],
      ]),
    );
    expect(await deliverWebhook(db, "00000000-0000-0000-0000-000000000000")).toBe("skipped");
  });

  it("pings an endpoint, lists its deliveries, and requeues anything pending", async () => {
    const endpoint = await createWebhookEndpoint(db, { url: "https://example.com/a" });

    const id = await pingWebhookEndpoint(db, fakeQueue, endpoint.id);

    const deliveries = await listWebhookDeliveries(db, endpoint.id);
    expect(deliveries).toEqual([
      expect.objectContaining({ id, event: "ping", status: "pending", attempts: 0 }),
    ]);
    expect(queue.addBulk).toHaveBeenCalledTimes(1);

    expect(await requeuePendingDeliveries(db, fakeQueue)).toBe(1);
    expect(queue.addBulk).toHaveBeenLastCalledWith([
      expect.objectContaining({ opts: expect.objectContaining({ jobId: id }) as unknown }),
    ]);
    expect((await listWebhookEndpoints(db))[0]?.deliveries).toEqual({
      pending: 1,
      delivered: 0,
      failed: 0,
    });
  });

  it("finds nothing for unknown or malformed endpoint ids", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(await pingWebhookEndpoint(db, fakeQueue, missing)).toBeNull();
    expect(await listWebhookDeliveries(db, missing)).toBeNull();
    expect(await listWebhookDeliveries(db, "nope")).toBeNull();
    expect(await deactivateWebhookEndpoint(db, missing)).toBe(false);
    expect(await deactivateWebhookEndpoint(db, "nope")).toBe(false);
  });
});
