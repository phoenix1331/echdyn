import { eq, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { corrections, documents, documentTypes, extractions, records } from "./schema";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("database schema", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 1 });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
  });

  afterAll(async () => {
    await close();
  });

  async function seedDocument(sha256 = "a".repeat(64)) {
    const [type] = await db
      .insert(documentTypes)
      .values({ slug: "energy-bill", name: "Energy bill", version: 1, schema: { type: "object" } })
      .onConflictDoNothing()
      .returning();
    const typeId =
      type?.id ??
      (await db.select().from(documentTypes).where(eq(documentTypes.slug, "energy-bill")))[0]?.id;

    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: typeId ?? "",
        storageKey: `documents/${sha256}.pdf`,
        originalFilename: "bill.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        sha256,
      })
      .returning();

    if (!document) {
      throw new Error("document insert returned no row");
    }

    return document;
  }

  async function seedExtraction(documentId: string, parsed: Record<string, unknown>) {
    const [extraction] = await db
      .insert(extractions)
      .values({
        documentId,
        model: "qwen3:8b",
        promptVersion: "v1",
        runNumber: 1,
        rawOutput: JSON.stringify(parsed),
        parsed,
        durationMs: 1200,
      })
      .returning();

    if (!extraction) {
      throw new Error("extraction insert returned no row");
    }

    return extraction;
  }

  it("re-running migrations is a no-op", async () => {
    await expect(migrateDatabase(db)).resolves.toBeUndefined();
  });

  it("defaults new documents to queued with timestamps", async () => {
    const document = await seedDocument();

    expect(document.status).toBe("queued");
    expect(document.createdAt).toBeInstanceOf(Date);
    expect(document.updatedAt).toBeInstanceOf(Date);
  });

  it("bumps updatedAt when a document changes", async () => {
    const document = await seedDocument();
    await db.execute(sql`select pg_sleep(0.01)`);

    const [updated] = await db
      .update(documents)
      .set({ status: "extracting" })
      .where(eq(documents.id, document.id))
      .returning();

    expect(updated?.status).toBe("extracting");
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(document.updatedAt.getTime());
  });

  it("rejects a duplicate file for the same document type", async () => {
    await seedDocument("b".repeat(64));

    await expect(seedDocument("b".repeat(64))).rejects.toThrow();
  });

  it("rejects a duplicate document type slug and version", async () => {
    await db
      .insert(documentTypes)
      .values({ slug: "invoice", name: "Invoice", version: 1, schema: {} });

    await expect(
      db.insert(documentTypes).values({ slug: "invoice", name: "Invoice", version: 1, schema: {} }),
    ).rejects.toThrow();
  });

  it("stores extractions with empty validation errors by default", async () => {
    const document = await seedDocument();
    const extraction = await seedExtraction(document.id, { total: 120.5 });

    expect(extraction.validationErrors).toEqual([]);
    expect(extraction.parsed).toEqual({ total: 120.5 });
  });

  it("queries approved records by a JSONB field value", async () => {
    const cheap = await seedDocument("c".repeat(64));
    const dear = await seedDocument("d".repeat(64));

    for (const [document, unitRate] of [
      [cheap, 0.24],
      [dear, 0.34],
    ] as const) {
      const extraction = await seedExtraction(document.id, { unit_rate: unitRate });
      await db.insert(records).values({
        documentId: document.id,
        extractionId: extraction.id,
        documentTypeId: document.documentTypeId,
        data: { unit_rate: unitRate },
        approvedBy: "auto",
      });
    }

    const rows = await db
      .select({ documentId: records.documentId })
      .from(records)
      .where(sql`(${records.data}->>'unit_rate')::numeric > 0.30`);

    expect(rows).toEqual([{ documentId: dear.id }]);
  });

  it("cascades deletes from documents to extractions, records and corrections", async () => {
    const document = await seedDocument();
    const extraction = await seedExtraction(document.id, { total: 1 });
    await db.insert(records).values({
      documentId: document.id,
      extractionId: extraction.id,
      documentTypeId: document.documentTypeId,
      data: { total: 2 },
      approvedBy: "admin",
    });
    await db.insert(corrections).values({
      documentId: document.id,
      extractionId: extraction.id,
      field: "total",
      oldValue: 1,
      newValue: 2,
      reviewer: "admin",
    });

    await db.delete(documents).where(eq(documents.id, document.id));

    expect(await db.select().from(extractions)).toHaveLength(0);
    expect(await db.select().from(records)).toHaveLength(0);
    expect(await db.select().from(corrections)).toHaveLength(0);
  });

  it("declares the expected foreign keys", () => {
    const references = [documents, extractions, records, corrections].flatMap((table) =>
      getTableConfig(table).foreignKeys.map((fk) => {
        const { foreignTable, columns } = fk.reference();
        return `${getTableName(table)}.${columns.map((c) => c.name).join()} -> ${getTableName(foreignTable)} (${fk.onDelete ?? "no action"})`;
      }),
    );

    expect(references.sort()).toEqual([
      "corrections.document_id -> documents (cascade)",
      "corrections.extraction_id -> extractions (no action)",
      "documents.document_type_id -> document_types (no action)",
      "extractions.document_id -> documents (cascade)",
      "records.document_id -> documents (cascade)",
      "records.document_type_id -> document_types (no action)",
      "records.extraction_id -> extractions (no action)",
    ]);
  });

  it("indexes JSONB columns with GIN", async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where indexdef ilike '%using gin%' order by indexname`,
    );

    expect(rows.map((row) => row.indexname)).toEqual([
      "extractions_parsed_gin_idx",
      "records_data_gin_idx",
    ]);
  });
});
