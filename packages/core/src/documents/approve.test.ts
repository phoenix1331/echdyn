import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { corrections, documents, documentTypes, extractions, records } from "../db/schema";
import { energyBill } from "../document-types/energy-bill";
import { toJsonSchema } from "../document-types/registry";
import { approveDocument, coerceInput, ReviewError } from "./approve";

const testUrl = process.env.TEST_DATABASE_URL;

// Passes every business rule (bill-001 from the synthetic set)
const bill = {
  supplier: "Northern Power Ltd",
  account_number: "13346995",
  meter_point_number: "8798298888",
  billing_period_start: "2025-07-22",
  billing_period_end: "2025-08-20",
  consumption_kwh: 6083,
  unit_rate_pence: 6.39,
  standing_charge_pence_per_day: 79.04,
  subtotal_gbp: 412.41,
  vat_rate_percent: 20,
  vat_gbp: 82.48,
  total_gbp: 494.89,
};

describe("coerceInput", () => {
  it("reads numbers the way people type them", () => {
    expect(coerceInput(" £1,234.50 ", "number")).toBe(1234.5);
    expect(coerceInput("20%", "number")).toBe(20);
    expect(coerceInput("7", "integer")).toBe(7);
  });

  it("leaves text that is not a number for the schema to reject", () => {
    expect(coerceInput("about 40", "number")).toBe("about 40");
    expect(coerceInput("  ", "number")).toBe("");
  });

  it("trims text fields", () => {
    expect(coerceInput("  Northern Power Ltd ", "string")).toBe("Northern Power Ltd");
  });
});

describe.skipIf(!testUrl)("approveDocument", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  let documentId: string;
  let runOneId: string;

  async function insertRun(runNumber: number, parsed: Record<string, unknown> | null, at: Date) {
    const [row] = await db
      .insert(extractions)
      .values({
        documentId,
        model: "llama3.2",
        promptVersion: "text-v2",
        runNumber,
        rawOutput: JSON.stringify(parsed),
        parsed,
        durationMs: 1000,
        createdAt: at,
      })
      .returning();
    return row?.id ?? "";
  }

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    const [type] = await db
      .insert(documentTypes)
      .values({
        slug: energyBill.slug,
        name: energyBill.name,
        version: energyBill.version,
        schema: toJsonSchema(energyBill),
      })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: type?.id ?? "",
        storageKey: "uk-energy-bill/ab/abc.pdf",
        originalFilename: "bill.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        status: "needs_review",
        flags: [{ field: "vat_gbp", message: "Run 1: VAT is wrong", rule: "vat-amount" }],
      })
      .returning();
    documentId = document?.id ?? "";
    runOneId = await insertRun(1, { ...bill, vat_gbp: 494.89 }, new Date(Date.UTC(2026, 9, 30)));
    await insertRun(2, bill, new Date(Date.UTC(2026, 9, 30, 0, 1)));
  });

  afterAll(async () => {
    await close();
  });

  it("applies corrections over run 1, records each change and approves the document", async () => {
    const result = await approveDocument(db, documentId, {
      reviewer: "admin",
      corrections: { vat_gbp: "£82.48", supplier: "Northern Power Ltd", unknown_field: "x" },
    });

    expect(result).toMatchObject({
      approved: true,
      data: bill,
      corrected: ["vat_gbp"],
      document: { slug: "uk-energy-bill", filename: "bill.pdf", sha256: "a".repeat(64) },
    });

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(document?.status).toBe("approved");

    const stored = await db.select().from(records);
    expect(stored).toEqual([
      expect.objectContaining({
        documentId,
        extractionId: runOneId,
        data: bill,
        approvedBy: "admin",
      }),
    ]);

    // Unchanged and unknown fields leave no trail
    const trail = await db.select().from(corrections);
    expect(trail).toEqual([
      expect.objectContaining({
        documentId,
        extractionId: runOneId,
        field: "vat_gbp",
        oldValue: 494.89,
        newValue: 82.48,
        reviewer: "admin",
      }),
    ]);
  });

  it("uses the latest attempt at run 1 when a retried job stored it twice", async () => {
    const retried = await insertRun(1, bill, new Date(Date.UTC(2026, 9, 30, 0, 5)));

    const result = await approveDocument(db, documentId, { reviewer: "admin" });

    expect(result).toMatchObject({ approved: true, corrected: [] });
    const [record] = await db.select().from(records);
    expect(record?.extractionId).toBe(retried);
    expect(await db.select().from(corrections)).toEqual([]);
  });

  it("blocks a failing business rule until the reviewer overrides it", async () => {
    const blocked = await approveDocument(db, documentId, { reviewer: "admin" });

    expect(blocked).toMatchObject({ approved: false });
    expect(blocked.approved ? [] : blocked.errors).toContainEqual(
      expect.objectContaining({ field: "vat_gbp", rule: "vat-amount" }),
    );
    expect(blocked.approved ? [] : blocked.fields).toContain("total_gbp");
    expect(await db.select().from(records)).toEqual([]);

    const overridden = await approveDocument(db, documentId, {
      reviewer: "admin",
      overrideChecks: true,
    });

    expect(overridden).toMatchObject({ approved: true, data: { vat_gbp: 494.89 } });
  });

  it("never approves past a schema error, even when overriding", async () => {
    const result = await approveDocument(db, documentId, {
      reviewer: "admin",
      corrections: { consumption_kwh: "lots", vat_gbp: "82.48" },
      overrideChecks: true,
    });

    expect(result).toMatchObject({
      approved: false,
      errors: [{ field: "consumption_kwh", message: "Enter a number" }],
    });
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(document?.status).toBe("needs_review");
    expect(await db.select().from(corrections)).toEqual([]);
  });

  it("lets the reviewer fill in every field when run 1 was not JSON", async () => {
    await db.delete(extractions);
    await insertRun(1, null, new Date());

    const missing = await approveDocument(db, documentId, { reviewer: "admin" });
    expect(missing.approved ? [] : missing.errors).toHaveLength(12);

    const typed = Object.fromEntries(
      Object.entries(bill).map(([key, value]) => [key, String(value)]),
    );
    const result = await approveDocument(db, documentId, { reviewer: "admin", corrections: typed });

    expect(result).toMatchObject({ approved: true, data: bill });
    const trail = await db.select().from(corrections);
    expect(trail).toHaveLength(12);
    expect(trail[0]?.oldValue).toBeNull();
  });

  it("refuses a second approval, so only one record is ever written", async () => {
    await approveDocument(db, documentId, { reviewer: "admin", corrections: { vat_gbp: "82.48" } });

    await expect(approveDocument(db, documentId, { reviewer: "admin" })).rejects.toMatchObject({
      code: "not_reviewable",
    });
    expect(await db.select().from(records)).toHaveLength(1);
  });

  it("lets only one of two simultaneous approvals win", async () => {
    const attempts = await Promise.allSettled([
      approveDocument(db, documentId, { reviewer: "admin", corrections: { vat_gbp: "82.48" } }),
      approveDocument(db, documentId, { reviewer: "admin", corrections: { vat_gbp: "82.48" } }),
    ]);

    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const [lost] = attempts.filter((a) => a.status === "rejected");
    expect(lost?.reason).toBeInstanceOf(ReviewError);
    expect(await db.select().from(records)).toHaveLength(1);
    expect(await db.select().from(corrections)).toHaveLength(1);
  });

  it("reports a missing document, a type with no definition, and a document with no runs", async () => {
    await expect(
      approveDocument(db, "00000000-0000-0000-0000-000000000000", { reviewer: "admin" }),
    ).rejects.toMatchObject({ code: "not_found" });

    await db.delete(extractions);
    await expect(approveDocument(db, documentId, { reviewer: "admin" })).rejects.toMatchObject({
      code: "nothing_extracted",
    });

    await db.update(documentTypes).set({ version: 99 });
    await expect(approveDocument(db, documentId, { reviewer: "admin" })).rejects.toMatchObject({
      code: "unknown_type",
    });
  });
});
