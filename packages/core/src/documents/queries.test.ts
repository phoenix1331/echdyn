import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { documents, documentTypes, extractions, type DocumentStatus } from "../db/schema";
import {
  countDocumentsByStatus,
  estimateProcessingMs,
  getDocumentSummary,
  listDocuments,
  listDocumentTypeOptions,
} from "./queries";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("document queries", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  let billTypeId: string;
  let invoiceTypeId: string;
  let created = 0;

  async function insertType(slug: string, name: string, version = 1): Promise<string> {
    const [row] = await db
      .insert(documentTypes)
      .values({ slug, name, version, schema: {} })
      .returning({ id: documentTypes.id });
    return row?.id ?? "";
  }

  async function insertDocument(
    filename: string,
    status: DocumentStatus,
    extra: Partial<typeof documents.$inferInsert> = {},
  ): Promise<string> {
    created += 1;
    const [row] = await db
      .insert(documents)
      .values({
        documentTypeId: billTypeId,
        storageKey: filename,
        originalFilename: filename,
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: String(created).padStart(64, "0"),
        status,
        // Spaced a minute apart so ordering by upload time is deterministic
        createdAt: new Date(Date.UTC(2026, 9, 30, 9, created)),
        ...extra,
      })
      .returning({ id: documents.id });
    return row?.id ?? "";
  }

  async function insertRuns(documentId: string, ...durations: number[]): Promise<void> {
    await db.insert(extractions).values(
      durations.map((durationMs, i) => ({
        documentId,
        model: "m",
        promptVersion: "v",
        runNumber: i + 1,
        rawOutput: "{}",
        durationMs,
      })),
    );
  }

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    created = 0;
    billTypeId = await insertType("uk-energy-bill", "UK business energy bill");
    invoiceTypeId = await insertType("invoice", "Invoice");
  });

  afterAll(async () => {
    await close();
  });

  describe("listDocuments", () => {
    it("lists newest first with type, flags and progress", async () => {
      await insertDocument("old.pdf", "approved");
      await insertDocument("flagged.pdf", "needs_review", {
        flags: [
          { field: "vat_gbp", message: "a" },
          { field: "total_gbp", message: "b" },
          { field: "total_gbp", message: "c", rule: "run-mismatch" },
        ],
      });
      await insertDocument("running.pdf", "extracting", { stage: "Reading PDF" });

      const page = await listDocuments(db);

      expect(page).toMatchObject({ total: 3, page: 1, pageCount: 1 });
      expect(page.items.map((d) => d.filename)).toEqual(["running.pdf", "flagged.pdf", "old.pdf"]);
      expect(page.items[0]).toMatchObject({
        status: "extracting",
        stage: "Reading PDF",
        queueAhead: null,
        documentType: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
      });
      expect(page.items[1]?.flagCount).toBe(2);
      expect(page.items[2]?.flagCount).toBe(0);
    });

    it("counts the documents ahead of each queued one, oldest first", async () => {
      await insertDocument("done.pdf", "approved");
      await insertDocument("running.pdf", "extracting");
      const second = await insertDocument("second.pdf", "queued");
      const third = await insertDocument("third.pdf", "queued");

      const { items } = await listDocuments(db, { status: "queued" });

      expect(items.map((d) => [d.id, d.queueAhead])).toEqual([
        [third, 2],
        [second, 1],
      ]);
    });

    it("filters by status, document type and filename", async () => {
      await insertDocument("march-bill.pdf", "approved");
      await insertDocument("april-bill.pdf", "needs_review");
      await insertDocument("march-invoice.pdf", "approved", { documentTypeId: invoiceTypeId });

      const names = async (filters: Parameters<typeof listDocuments>[1]) =>
        (await listDocuments(db, filters)).items.map((d) => d.filename);

      expect(await names({ status: "approved" })).toEqual(["march-invoice.pdf", "march-bill.pdf"]);
      expect(await names({ documentType: "invoice" })).toEqual(["march-invoice.pdf"]);
      expect(await names({ search: "  MARCH " })).toEqual(["march-invoice.pdf", "march-bill.pdf"]);
      expect(await names({ search: "march", documentType: "uk-energy-bill" })).toEqual([
        "march-bill.pdf",
      ]);
      expect(await names({ search: "   " })).toHaveLength(3);
    });

    it("treats LIKE wildcards in a search as plain characters", async () => {
      await insertDocument("100%_done.pdf", "approved");
      await insertDocument("100 done.pdf", "approved");

      const { items } = await listDocuments(db, { search: "100%_" });

      expect(items.map((d) => d.filename)).toEqual(["100%_done.pdf"]);
    });

    it("pages through results and clamps a page below 1", async () => {
      for (const name of ["a", "b", "c", "d", "e"]) {
        await insertDocument(`${name}.pdf`, "approved");
      }

      const second = await listDocuments(db, { page: 2, pageSize: 2 });
      const clamped = await listDocuments(db, { page: -3, pageSize: 2 });
      const empty = await listDocuments(db, { status: "failed" });

      expect(second).toMatchObject({ total: 5, page: 2, pageCount: 3 });
      expect(second.items.map((d) => d.filename)).toEqual(["c.pdf", "b.pdf"]);
      expect(clamped.page).toBe(1);
      expect(empty).toMatchObject({ items: [], total: 0, pageCount: 1 });
    });
  });

  describe("countDocumentsByStatus", () => {
    it("counts every status, including empty ones, within the other filters", async () => {
      await insertDocument("march-bill.pdf", "approved");
      await insertDocument("april-bill.pdf", "approved");
      await insertDocument("may-bill.pdf", "queued");
      await insertDocument("march-invoice.pdf", "failed", { documentTypeId: invoiceTypeId });

      expect(await countDocumentsByStatus(db, { documentType: "uk-energy-bill" })).toEqual({
        queued: 1,
        extracting: 0,
        needs_review: 0,
        approved: 2,
        failed: 0,
      });
      expect(await countDocumentsByStatus(db, { search: "march" })).toMatchObject({
        approved: 1,
        failed: 1,
        queued: 0,
      });
    });
  });

  describe("getDocumentSummary", () => {
    it("returns one document with its queue position", async () => {
      await insertDocument("first.pdf", "queued");
      const id = await insertDocument("second.pdf", "queued");

      expect(await getDocumentSummary(db, id)).toMatchObject({
        id,
        filename: "second.pdf",
        status: "queued",
        queueAhead: 1,
      });
    });

    it("returns null for an unknown id or one that is not a UUID", async () => {
      expect(await getDocumentSummary(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
      expect(await getDocumentSummary(db, "not-a-uuid")).toBeNull();
    });
  });

  describe("listDocumentTypeOptions", () => {
    it("lists each slug once with its latest name", async () => {
      await insertType("invoice", "Supplier invoice", 2);

      expect(await listDocumentTypeOptions(db)).toEqual([
        { slug: "invoice", name: "Supplier invoice" },
        { slug: "uk-energy-bill", name: "UK business energy bill" },
      ]);
    });
  });

  describe("estimateProcessingMs", () => {
    it("is null before anything has been processed", async () => {
      expect(await estimateProcessingMs(db)).toBeNull();
    });

    it("takes the median of total model time per document", async () => {
      await insertRuns(await insertDocument("a.pdf", "approved"), 15_000, 15_000);
      await insertRuns(await insertDocument("b.pdf", "approved"), 20_000, 20_000);
      await insertRuns(await insertDocument("c.pdf", "approved"), 50_000, 50_000);

      expect(await estimateProcessingMs(db)).toBe(40_000);
    });

    it("only looks at the most recent documents", async () => {
      await insertRuns(await insertDocument("slow.pdf", "approved"), 300_000);
      await insertRuns(await insertDocument("fast.pdf", "approved"), 30_000);

      expect(await estimateProcessingMs(db, 1)).toBe(30_000);
    });
  });
});
