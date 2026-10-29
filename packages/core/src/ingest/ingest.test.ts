import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createDatabase } from "../db/client";
import { documents } from "../db/schema";
import { seedDocumentTypes } from "../document-types/seed";
import { createDocumentQueue, createRedisConnection, type DocumentQueue } from "../queue/queue";
import { createStorage } from "../storage/storage";
import { IngestError, ingestDocument, MAX_UPLOAD_BYTES } from "./ingest";

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;

function pdf(content: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${content}`);
}

describe.skipIf(!testUrl || !testBucket)("ingestDocument", () => {
  const config = loadConfig();
  const { db, close } = createDatabase(testUrl ?? "", { max: 4 });
  const storage = createStorage({ ...config, S3_BUCKET: testBucket ?? "" });
  const connection = createRedisConnection(config.REDIS_URL);
  const queue = createDocumentQueue(connection, "echdyn-test");
  const deps = { db, storage, queue };

  beforeAll(async () => {
    await storage.ensureBucket();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await seedDocumentTypes(db);
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.close();
    await connection.quit();
    await close();
  });

  it("stores the file, records the document and queues a job", async () => {
    const bytes = pdf(`bill ${Date.now()}`);

    const result = await ingestDocument(deps, {
      documentTypeSlug: "uk-energy-bill",
      filename: "august.pdf",
      bytes,
    });

    expect(result).toMatchObject({ status: "queued", duplicate: false });

    const [row] = await db.select().from(documents).where(eq(documents.id, result.id));
    expect(row).toMatchObject({ originalFilename: "august.pdf", sizeBytes: bytes.byteLength });
    expect(row?.storageKey).toBe(`uk-energy-bill/${row?.sha256.slice(0, 2)}/${row?.sha256}.pdf`);
    expect(await storage.get(row?.storageKey ?? "")).toEqual(bytes);

    const job = await queue.getJob(result.id);
    expect(job?.data).toEqual({ documentId: result.id });
  });

  it("returns the existing document for a duplicate upload without queueing again", async () => {
    const bytes = pdf("same bill");
    const input = { documentTypeSlug: "uk-energy-bill", filename: "a.pdf", bytes };

    const first = await ingestDocument(deps, input);
    const second = await ingestDocument(deps, { ...input, filename: "copy-of-a.pdf" });

    expect(second).toEqual({ id: first.id, status: "queued", duplicate: true });
    expect(await db.select().from(documents)).toHaveLength(1);
    expect(await queue.getJobCounts("waiting")).toEqual({ waiting: 1 });
  });

  it("keeps one document when identical uploads race", async () => {
    const input = { documentTypeSlug: "uk-energy-bill", filename: "race.pdf", bytes: pdf("race") };

    const results = await Promise.all([
      ingestDocument(deps, input),
      ingestDocument(deps, input),
      ingestDocument(deps, input),
    ]);

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it("returns the winner when a concurrent upload inserts first", async () => {
    const input = { documentTypeSlug: "uk-energy-bill", filename: "slow.pdf", bytes: pdf("slow") };
    let winnerId = "";
    // The competing upload finishes while this one is still writing to storage,
    // so this request passed the duplicate pre-check but loses on the unique index
    const racingStorage = {
      ...storage,
      put: async (key: string, body: Uint8Array, contentType: string) => {
        await storage.put(key, body, contentType);
        winnerId = (await ingestDocument(deps, { ...input, filename: "fast.pdf" })).id;
      },
    };

    const result = await ingestDocument({ ...deps, storage: racingStorage }, input);

    expect(result).toEqual({ id: winnerId, status: "queued", duplicate: true });
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it("marks the document failed when it cannot be queued", async () => {
    const brokenQueue = {
      add: () => Promise.reject(new Error("redis down")),
    } as unknown as DocumentQueue;

    await expect(
      ingestDocument(
        { ...deps, queue: brokenQueue },
        { documentTypeSlug: "uk-energy-bill", filename: "x.pdf", bytes: pdf("no queue") },
      ),
    ).rejects.toThrow("redis down");

    const [row] = await db.select().from(documents);
    expect(row).toMatchObject({
      status: "failed",
      error: "Could not queue the document for processing",
    });
  });

  it("rethrows database errors that are not duplicates", async () => {
    const input = {
      documentTypeSlug: "uk-energy-bill",
      filename: "\u0000bad.pdf",
      bytes: pdf("null byte"),
    };

    await expect(ingestDocument(deps, input)).rejects.toThrow();
  });

  it.each([
    ["empty_file", new Uint8Array(), "uk-energy-bill"],
    ["too_large", new Uint8Array(MAX_UPLOAD_BYTES + 1), "uk-energy-bill"],
    ["not_pdf", new TextEncoder().encode("PK\u0003\u0004 zip"), "uk-energy-bill"],
    ["unknown_document_type", pdf("ok"), "invoice"],
  ] as const)("rejects with %s", async (code, bytes, documentTypeSlug) => {
    const error = await ingestDocument(deps, { documentTypeSlug, filename: "f.pdf", bytes }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(IngestError);
    expect(error).toMatchObject({ code });
  });
});
