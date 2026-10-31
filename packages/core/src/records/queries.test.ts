import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { corrections, documents, documentTypes, extractions, records } from "../db/schema";
import { getRecord, listRecords } from "./queries";
import { parseRecordQuery } from "./query";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("record queries", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const ids: Record<string, string> = {};

  /** An approved bill: name, unit rate, supplier, billing start, approval day */
  async function approved(
    name: string,
    rate: number,
    supplier: string,
    start: string,
    approvedAt: string,
    slug = "uk-energy-bill",
  ) {
    const [type] = await db
      .select()
      .from(documentTypes)
      .where(sql`${documentTypes.slug} = ${slug}`);
    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: type?.id ?? "",
        storageKey: name,
        originalFilename: `${name}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: name.padEnd(64, "0"),
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
        data: { unit_rate_pence: rate, supplier, billing_period_start: start },
        approvedBy: "admin",
        approvedAt: new Date(approvedAt),
      })
      .returning();
    ids[name] = record?.id ?? "";
    return { document, extraction };
  }

  const list = async (query: string) =>
    (await listRecords(db, parseRecordQuery(new URLSearchParams(query)))).items.map((r) =>
      r.filename.replace(".pdf", ""),
    );

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await db.insert(documentTypes).values([
      { slug: "uk-energy-bill", name: "UK business energy bill", version: 1, schema: {} },
      { slug: "other", name: "Other", version: 1, schema: {} },
    ]);
    await approved("cheap", 6.39, "Northern Power Ltd", "2026-01-10", "2026-10-01T09:00:00Z");
    await approved("dear", 33.57, "Severn Valley Energy", "2026-03-01", "2026-10-15T09:00:00Z");
    await approved("dearer", 41.2, "100% Green Ltd", "2026-06-01", "2026-10-31T23:30:00Z");
    await approved("elsewhere", 50, "Other Co", "2026-06-01", "2026-10-20T09:00:00Z", "other");
  });

  afterAll(async () => {
    await close();
  });

  it("lists approved records newest first, with their document and type", async () => {
    const page = await listRecords(db, parseRecordQuery(new URLSearchParams("")));

    expect(page.items.map((r) => r.filename)).toEqual([
      "dearer.pdf",
      "elsewhere.pdf",
      "dear.pdf",
      "cheap.pdf",
    ]);
    expect(page.items[0]).toMatchObject({
      documentType: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
      data: { unit_rate_pence: 41.2 },
      approvedBy: "admin",
    });
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 25, pageCount: 1 });
  });

  it("filters by type and by numeric field values, compared as numbers", async () => {
    expect(await list("type=uk-energy-bill")).toEqual(["dearer", "dear", "cheap"]);
    // As text, "6.39" > "30"; as numbers it is not
    expect(await list("type=uk-energy-bill&filter=unit_rate_pence:gt:30")).toEqual([
      "dearer",
      "dear",
    ]);
    expect(await list("type=uk-energy-bill&filter=unit_rate_pence:lte:33.57")).toEqual([
      "dear",
      "cheap",
    ]);
    expect(await list("type=uk-energy-bill&filter=unit_rate_pence:eq:6.39")).toEqual(["cheap"]);
    expect(
      await list("type=uk-energy-bill&filter=unit_rate_pence:gt:7&filter=unit_rate_pence:lt:40"),
    ).toEqual(["dear"]);
  });

  it("compares dates in order and text without case, treating % literally", async () => {
    expect(await list("type=uk-energy-bill&filter=billing_period_start:gte:2026-03-01")).toEqual([
      "dearer",
      "dear",
    ]);
    expect(await list("type=uk-energy-bill&filter=supplier:contains:VALLEY")).toEqual(["dear"]);
    expect(await list("type=uk-energy-bill&filter=supplier:contains:0%")).toEqual(["dearer"]);
    expect(await list("type=uk-energy-bill&filter=supplier:contains:_")).toEqual([]);
    expect(await list("type=uk-energy-bill&filter=supplier:ne:Northern Power Ltd")).toEqual([
      "dearer",
      "dear",
    ]);
  });

  it("filters by approval day, both ends inclusive", async () => {
    expect(await list("approved_from=2026-10-15")).toEqual(["dearer", "elsewhere", "dear"]);
    // 23:30 on the 31st still counts as approved on the 31st
    expect(await list("approved_from=2026-10-31&approved_to=2026-10-31")).toEqual(["dearer"]);
    expect(await list("approved_to=2026-10-01")).toEqual(["cheap"]);
  });

  it("pages, counting every match", async () => {
    const page = await listRecords(db, parseRecordQuery(new URLSearchParams("page=2&page_size=3")));

    expect(page.items.map((r) => r.filename)).toEqual(["cheap.pdf"]);
    expect(page).toMatchObject({ total: 4, page: 2, pageSize: 3, pageCount: 2 });
  });

  it("returns one record with its run and every correction, oldest first", async () => {
    const { document, extraction } = await approved(
      "fixed",
      18.3,
      "Severn Valley Energy",
      "2026-02-10",
      "2026-10-30T09:00:00Z",
    );
    const base = {
      documentId: document?.id ?? "",
      extractionId: extraction?.id ?? "",
      reviewer: "admin",
    };
    await db.insert(corrections).values([
      {
        ...base,
        field: "vat_gbp",
        oldValue: 1,
        newValue: 2,
        createdAt: new Date("2026-10-30T09:01:00Z"),
      },
      {
        ...base,
        field: "unit_rate_pence",
        oldValue: 0.183,
        newValue: 18.3,
        createdAt: new Date("2026-10-30T09:00:00Z"),
      },
    ]);

    const record = await getRecord(db, ids.fixed ?? "");

    expect(record).toMatchObject({
      filename: "fixed.pdf",
      extractionId: extraction?.id,
      data: { unit_rate_pence: 18.3 },
    });
    expect(record?.corrections.map((c) => [c.field, c.oldValue, c.newValue])).toEqual([
      ["unit_rate_pence", 0.183, 18.3],
      ["vat_gbp", 1, 2],
    ]);
  });

  it("finds nothing for an unknown id or one that is not a uuid", async () => {
    expect(await getRecord(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await getRecord(db, "nope")).toBeNull();
  });
});
