import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { documents, extractions } from "../../db/schema";
import { seedDocumentTypes } from "../../document-types/seed";
import { fakeChatClient as fakeClient } from "../../testing/fake-chat-client";
import { ingestDocument } from "../../ingest/ingest";
import type { DocumentQueue } from "../../queue/queue";
import { createStorage } from "../../storage/storage";
import { processDocument, type PipelineContext } from "../pipeline";
import { createExtractStage } from "./extract";
import { preProcessStage } from "./pre-process";
import { renderPagesStage } from "./render";

const fixtures = resolve(import.meta.dirname, "../../../../../fixtures");
const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;

describe.skipIf(!testUrl || !testBucket)("extract stage", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const storage = createStorage({ ...loadConfig(), S3_BUCKET: testBucket ?? "" });
  const noopQueue = { add: () => Promise.resolve() } as unknown as DocumentQueue;

  beforeAll(async () => {
    await storage.ensureBucket();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await seedDocumentTypes(db);
  });

  afterAll(async () => {
    await close();
  });

  async function upload(name: string): Promise<string> {
    const bytes = new Uint8Array(await readFile(resolve(fixtures, name)));
    const { id } = await ingestDocument(
      { db, storage, queue: noopQueue },
      { documentTypeSlug: "uk-energy-bill", filename: name, bytes },
    );
    return id;
  }

  it("extracts a text document with the printed schema and type hints, numbering each run", async () => {
    const id = await upload("sample-energy-bill.pdf");
    const client = fakeClient(['{"total_gbp": "£386.88"}', '{"total_gbp": "386.88"}']);
    const extract = createExtractStage({ client, model: "llama3.2" });
    let runs: PipelineContext["extractions"] = [];
    const capture = {
      name: "capture",
      run: (ctx: PipelineContext) => {
        runs = ctx.extractions;
        return Promise.resolve();
      },
    };

    await processDocument({ db, storage }, id, [preProcessStage, extract, extract, capture]);

    expect(runs.map((r) => r.runNumber)).toEqual([1, 2]);
    expect(runs.map((r) => r.parsed)).toEqual([{ total_gbp: 386.88 }, { total_gbp: 386.88 }]);
    expect(client.requests[0]?.messages?.[0]?.content).toContain("never the customer being billed");
    expect(client.requests[0]?.messages?.[1]?.content).toContain("Northern Power Ltd");
    expect(client.requests[0]?.format).toMatchObject({
      required: expect.arrayContaining(["total_gbp", "meter_point_number"]) as unknown,
      properties: expect.objectContaining({
        total_gbp: expect.objectContaining({ type: "string" }) as unknown,
      }) as unknown,
    });
    expect(await db.select().from(extractions).where(eq(extractions.documentId, id))).toHaveLength(
      2,
    );
  });

  it("reads a scan's rendered pages with the vision model and its own prompt", async () => {
    const id = await upload("scanned-energy-bill.pdf");
    const client = fakeClient(['{"total_gbp": "£386.88"}']);

    await processDocument({ db, storage }, id, [
      preProcessStage,
      renderPagesStage,
      createExtractStage({ client, model: "llama3.2", visionModel: "qwen2.5vl:3b" }),
    ]);

    expect(client.requests[0]?.model).toBe("qwen2.5vl:3b");
    const images = client.requests[0]?.messages?.[1]?.images ?? [];
    expect(images).toHaveLength(1);
    // A base64 PNG, so the model sees the page the reviewer sees
    expect(String(images[0]).startsWith("iVBORw0KGgo")).toBe(true);
    const [row] = await db.select().from(extractions).where(eq(extractions.documentId, id));
    expect(row).toMatchObject({
      model: "qwen2.5vl:3b",
      promptVersion: "vision-v2",
      parsed: { total_gbp: 386.88 },
    });
  });

  it("leaves a scan unread when no vision model is configured", async () => {
    const id = await upload("scanned-energy-bill.pdf");
    const client = fakeClient([]);

    await processDocument({ db, storage }, id, [
      preProcessStage,
      renderPagesStage,
      createExtractStage({ client, model: "llama3.2" }),
    ]);

    expect(client.requests).toHaveLength(0);
  });

  it("skips scans whose pages were never rendered", async () => {
    const id = await upload("scanned-energy-bill.pdf");
    const client = fakeClient([]);

    await processDocument({ db, storage }, id, [
      preProcessStage,
      createExtractStage({ client, model: "llama3.2", visionModel: "qwen2.5vl:3b" }),
    ]);

    expect(client.requests).toHaveLength(0);
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row?.status).toBe("needs_review");
  });
});
