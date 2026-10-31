import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { documents, documentTypes, extractions, records } from "../db/schema";
import { exportFilename, exportTable, toCsv, toXlsx, type ExportTable } from "./export";
import { parseRecordQuery } from "./query";

const testUrl = process.env.TEST_DATABASE_URL;

const table = (rows: unknown[][]): ExportTable => ({
  documentType: "uk-energy-bill",
  columns: [
    { key: "supplier", label: "Supplier", kind: "text" },
    { key: "total_gbp", label: "Total", kind: "number", currency: true },
    { key: "billing_period_start", label: "Period start", kind: "date" },
    { key: "approved_at", label: "Approved at", kind: "datetime" },
  ],
  rows,
  truncated: false,
});

const approvedAt = new Date(Date.UTC(2026, 9, 31, 9, 30));

describe("toCsv", () => {
  it("writes field keys as headers and values as plain text", () => {
    expect(toCsv(table([["Northern Power Ltd", 386.88, "2026-08-01", approvedAt]]))).toBe(
      "supplier,total_gbp,billing_period_start,approved_at\r\n" +
        "Northern Power Ltd,386.88,2026-08-01,2026-10-31T09:30:00.000Z\r\n",
    );
  });

  it("quotes commas, quotes and line breaks, and leaves missing values empty", () => {
    expect(toCsv(table([['Cymru Gas & Power, "CGP"', null, undefined, "two\nlines"]]))).toContain(
      '"Cymru Gas & Power, ""CGP""",,,"two\nlines"\r\n',
    );
  });

  it("defuses text a spreadsheet would run as a formula, but not negative numbers", () => {
    const csv = toCsv(
      table([
        ['=HYPERLINK("http://evil","x")', -12.5, "+44 800", "@SUM(A1)"],
        ["-x", 0, "\tlead", { a: 1 }],
      ]),
    );

    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")",-12.5,'+44 800,'@SUM(A1)`);
    expect(csv).toContain(`'-x,0,'\tlead,"{""a"":1}"`);
  });
});

describe("toXlsx", () => {
  it("writes a workbook with readable headers, real numbers, dates and £ formatting", async () => {
    const xlsx = await toXlsx(
      table([
        ["=cmd()", 1526.95, "2026-08-01", approvedAt],
        ["Severn Valley", null, null, approvedAt],
      ]),
    );
    const files = unzipSync(new Uint8Array(xlsx));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
    const strings = strFromU8(files["xl/sharedStrings.xml"] ?? new Uint8Array());
    const styles = strFromU8(files["xl/styles.xml"] ?? new Uint8Array());

    expect(strings).toContain("<t>Supplier</t>");
    expect(strings).toContain("<t>Period start</t>");
    // Typed as text: Excel shows it, never evaluates it
    expect(strings).toContain("<t>=cmd()</t>");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("<v>1526.95</v>");
    // 2026-08-01 as an Excel date serial, not as text
    expect(sheet).toContain("<v>46235</v>");
    expect(styles).toContain('formatCode="£#,##0.00"');
    expect(styles).toContain('formatCode="yyyy-mm-dd"');
    expect(sheet).toContain('state="frozen"');
    expect(Object.keys(files)).toContain("xl/workbook.xml");
  });

  it("writes a string for any other value, and sizes columns to their contents", async () => {
    const wide = table([["x".repeat(30), 1, "2026-01-01", approvedAt]]);
    const notes = table([[{ note: "x" }, 1, "2026-01-01", approvedAt]]);
    const unzip = async (t: ExportTable) => unzipSync(new Uint8Array(await toXlsx(t)));

    const sheet = strFromU8((await unzip(wide))["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
    const strings = strFromU8((await unzip(notes))["xl/sharedStrings.xml"] ?? new Uint8Array());

    // 30 characters plus padding; the date-time column is never narrower than its value
    expect(sheet).toMatch(/<col min="1" max="1" width="32"/);
    expect(sheet).toMatch(/<col min="4" max="4" width="2[0-9]"/);
    expect(strings).toContain('<t>{"note":"x"}</t>');
  });
});

describe("exportFilename", () => {
  it("names the file by type and day", () => {
    expect(exportFilename(table([]), "xlsx", new Date(Date.UTC(2026, 9, 31, 23)))).toBe(
      "uk-energy-bill-records-2026-10-31.xlsx",
    );
  });
});

describe.skipIf(!testUrl)("exportTable", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });

  async function approve(name: string, data: Record<string, unknown>, at: string) {
    const [type] = await db.select().from(documentTypes);
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
    await db.insert(records).values({
      documentId: document?.id ?? "",
      extractionId: extraction?.id ?? "",
      documentTypeId: type?.id ?? "",
      data,
      approvedBy: "admin",
      approvedAt: new Date(at),
    });
  }

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await db
      .insert(documentTypes)
      .values({ slug: "uk-energy-bill", name: "UK business energy bill", version: 1, schema: {} });
    await approve(
      "march",
      { supplier: "Northern Power Ltd", unit_rate_pence: 24.5, total_gbp: 386.88 },
      "2026-10-01T09:00:00Z",
    );
    await approve(
      "april",
      { supplier: "Severn Valley Energy", unit_rate_pence: 33.57 },
      "2026-10-02T09:00:00Z",
    );
  });

  afterAll(async () => {
    await close();
  });

  it("has a column per schema field in the definition's order, after the record's own", async () => {
    const exported = await exportTable(
      db,
      parseRecordQuery(new URLSearchParams("type=uk-energy-bill")),
    );

    expect(exported.columns.slice(0, 5).map((c) => c.key)).toEqual([
      "record_id",
      "filename",
      "approved_at",
      "approved_by",
      "supplier",
    ]);
    expect(exported.columns.at(-1)).toEqual({
      key: "total_gbp",
      label: "Total",
      kind: "number",
      currency: true,
    });
    expect(exported.columns.find((c) => c.key === "billing_period_start")?.kind).toBe("date");
    expect(exported.rows.map((row) => row[1])).toEqual(["april.pdf", "march.pdf"]);
    // A field the record lacks is empty, not missing
    expect(exported.rows[0]?.at(-1)).toBeNull();
    expect(exported.truncated).toBe(false);
  });

  it("applies the record filters and says when it had to stop", async () => {
    const filtered = await exportTable(
      db,
      parseRecordQuery(new URLSearchParams("type=uk-energy-bill&filter=unit_rate_pence:gt:30")),
    );
    expect(filtered.rows.map((row) => row[1])).toEqual(["april.pdf"]);

    const capped = await exportTable(
      db,
      parseRecordQuery(new URLSearchParams("type=uk-energy-bill")),
      1,
    );
    expect(capped.rows).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it("needs a document type, as the columns come from it", async () => {
    await expect(exportTable(db, parseRecordQuery(new URLSearchParams("")))).rejects.toThrow(
      "Exports are per document type",
    );
  });
});
