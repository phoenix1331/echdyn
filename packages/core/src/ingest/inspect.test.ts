import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createDatabase } from "../db/client";
import { documents, extractions } from "../db/schema";
import { seedDocumentTypes } from "../document-types/seed";
import type { DocumentQueue } from "../queue/queue";
import { createStorage } from "../storage/storage";
import { ingestDocument } from "./ingest";
import { estimateByPath, inspectDocument, queueState, readPath } from "./inspect";

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;
const fixtures = resolve(import.meta.dirname, "../../../../fixtures");
const fixture = (name: string) => readFile(resolve(fixtures, name)).then((b) => new Uint8Array(b));

describe("readPath", () => {
  it.each([
    [["text", "blank"], "text"],
    [["scan"], "vision"],
    [["text", "scan", "blank"], "mixed"],
    [["blank"], "none"],
    [[], "none"],
  ] as const)("%j is read by %s", (kinds, path) => {
    expect(readPath(kinds)).toBe(path);
  });
});

describe.skipIf(!testUrl || !testBucket)("inspectDocument", () => {
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

  async function inspect(name: string, bytes?: Uint8Array) {
    return inspectDocument(db, {
      documentTypeSlug: "uk-energy-bill",
      filename: name,
      bytes: bytes ?? (await fixture(name)),
    });
  }

  /** A finished document whose runs used `promptVersion` and took `ms` in total */
  async function history(promptVersion: string, ms: number, sha: string) {
    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: (await db.query.documentTypes.findFirst())?.id ?? "",
        storageKey: "k",
        originalFilename: "old.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: sha.repeat(64),
        status: "needs_review",
      })
      .returning();
    for (const runNumber of [1, 2]) {
      await db.insert(extractions).values({
        documentId: document?.id ?? "",
        model: "m",
        promptVersion,
        runNumber,
        rawOutput: "{}",
        durationMs: ms / 2,
      });
    }
  }

  it("describes a typed bill without storing anything", async () => {
    const inspection = await inspect("sample-energy-bill.pdf");

    expect(inspection).toEqual({
      filename: "sample-energy-bill.pdf",
      sizeBytes: (await fixture("sample-energy-bill.pdf")).byteLength,
      pageCount: 1,
      pageKinds: ["text"],
      path: "text",
      estimatedMs: null,
      pagesNotRead: 0,
      duplicate: null,
    });
    expect(await db.select().from(documents)).toEqual([]);
  });

  it("sees the scanned page behind a typed cover letter", async () => {
    expect(await inspect("mixed-energy-bill.pdf")).toMatchObject({
      pageCount: 2,
      pageKinds: ["text", "scan"],
      path: "mixed",
    });
  });

  it("points at the document an identical upload would resolve to", async () => {
    const bytes = await fixture("sample-energy-bill.pdf");
    const { id } = await ingestDocument(
      { db, storage, queue: noopQueue },
      { documentTypeSlug: "uk-energy-bill", filename: "march.pdf", bytes },
    );

    expect((await inspect("again.pdf", bytes)).duplicate).toMatchObject({
      id,
      filename: "march.pdf",
      status: "queued",
    });
  });

  it("estimates from recent documents on the same path, scaling scans by page", async () => {
    await history("text-v2", 30_000, "a");
    await history("text-v2", 40_000, "b");
    await history("vision-v2", 300_000, "c");

    expect(await estimateByPath(db)).toEqual({ text: 35_000, vision: 300_000, mixed: null });
    expect((await inspect("sample-energy-bill.pdf")).estimatedMs).toBe(35_000);
    // No mixed history yet: the vision median per scanned page is the nearest guide
    expect((await inspect("mixed-energy-bill.pdf")).estimatedMs).toBe(300_000);
    expect((await inspect("scanned-energy-bill.pdf")).estimatedMs).toBe(300_000);
  });

  it("refuses what ingest would refuse, and a PDF it cannot read", async () => {
    await expect(inspect("note.txt", new TextEncoder().encode("hello"))).rejects.toMatchObject({
      code: "not_pdf",
    });
    await expect(
      inspect("broken.pdf", new TextEncoder().encode("%PDF-1.7 not really")),
    ).rejects.toMatchObject({ code: "unreadable_pdf" });
    await expect(
      inspectDocument(db, {
        documentTypeSlug: "passport",
        filename: "x.pdf",
        bytes: await fixture("sample-energy-bill.pdf"),
      }),
    ).rejects.toMatchObject({ code: "unknown_document_type" });
  });

  it("counts the documents ahead in the queue and how long they will take", async () => {
    expect(await queueState(db)).toEqual({ ahead: 0, estimatedWaitMs: null });

    await history("text-v2", 30_000, "d");
    const [done] = await db.select().from(documents);
    await db
      .update(documents)
      .set({ status: "extracting" })
      .where(eq(documents.id, done?.id ?? ""));
    await ingestDocument(
      { db, storage, queue: noopQueue },
      {
        documentTypeSlug: "uk-energy-bill",
        filename: "b.pdf",
        bytes: await fixture("sample-energy-bill.pdf"),
      },
    );

    expect(await queueState(db)).toEqual({ ahead: 2, estimatedWaitMs: 60_000 });
  });
});
