import writeExcelFile, { type Row, type SheetData } from "write-excel-file/node";
import type { Database } from "../db/client";
import { getDocumentType, toJsonSchema } from "../document-types/registry";
import { listRecords } from "./queries";
import { RecordQueryError, type RecordQuery } from "./query";

/** Exports past this are cut short and say so; a records page is the place for more */
export const MAX_EXPORT_ROWS = 50_000;

export type ExportFormat = "csv" | "xlsx";

export interface ExportColumn {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "datetime";
  /** Pounds: shown as £1,234.56 in Excel */
  currency?: boolean;
}

export interface ExportTable {
  documentType: string;
  columns: ExportColumn[];
  rows: unknown[][];
  /** More records matched than MAX_EXPORT_ROWS */
  truncated: boolean;
}

const RECORD_COLUMNS: ExportColumn[] = [
  { key: "record_id", label: "Record ID", kind: "text" },
  { key: "filename", label: "File", kind: "text" },
  { key: "approved_at", label: "Approved at", kind: "datetime" },
  { key: "approved_by", label: "Approved by", kind: "text" },
];

/**
 * Every approved record of one type matching the query, one column per schema field in the
 * definition's order, so a sheet reads like the review screen. The type decides the columns,
 * so it is required.
 */
export async function exportTable(
  db: Database,
  query: Omit<RecordQuery, "page" | "pageSize">,
  maxRows = MAX_EXPORT_ROWS,
): Promise<ExportTable> {
  const definition = query.documentType ? getDocumentType(query.documentType) : undefined;
  if (!definition) {
    throw new RecordQueryError("Exports are per document type: add type=uk-energy-bill");
  }

  const properties = (toJsonSchema(definition).properties ?? {}) as Record<
    string,
    { type?: unknown; format?: unknown }
  >;
  const fields: ExportColumn[] = Object.keys(definition.schema.shape).map((key) => {
    const property = properties[key] ?? {};
    const display = definition.display?.[key];
    const numeric = property.type === "number" || property.type === "integer";
    return {
      key,
      label: display?.label ?? key,
      kind: numeric ? "number" : property.format === "date" ? "date" : "text",
      ...(display?.currency ? { currency: true } : {}),
    };
  });

  const page = await listRecords(db, { ...query, page: 1, pageSize: maxRows });
  return {
    documentType: definition.slug,
    columns: [...RECORD_COLUMNS, ...fields],
    rows: page.items.map((record) => [
      record.id,
      record.filename,
      record.approvedAt,
      record.approvedBy,
      ...fields.map((field) => record.data[field.key] ?? null),
    ]),
    truncated: page.total > maxRows,
  };
}

// A spreadsheet runs a cell starting with these as a formula: `=HYPERLINK(...)` in a supplier
// name could otherwise phone home when the export is opened (CSV injection)
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return String(value);
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 CSV with the field keys as headers, for scripts and other systems */
export function toCsv(table: ExportTable): string {
  const lines = [table.columns.map((column) => column.key), ...table.rows].map((row) =>
    row.map(csvCell).join(","),
  );
  return `${lines.join("\r\n")}\r\n`;
}

function xlsxCell(column: ExportColumn, value: unknown): Row[number] {
  if (value === null || value === undefined) {
    return null;
  }
  if (column.kind === "number" && typeof value === "number") {
    return { value, type: Number, ...(column.currency ? { format: "£#,##0.00" } : {}) };
  }
  if (column.kind === "date" && typeof value === "string") {
    return { value: new Date(`${value}T00:00:00Z`), type: Date, format: "yyyy-mm-dd" };
  }
  if (value instanceof Date) {
    return { value, type: Date, format: "yyyy-mm-dd hh:mm" };
  }
  // Typed as text, so Excel never evaluates it as a formula
  return { value: typeof value === "string" ? value : JSON.stringify(value), type: String };
}

/** Wide enough for the header and the longest value (as text), within reason */
function columnWidth(column: ExportColumn, rows: unknown[][], index: number): number {
  const longest = Math.max(
    column.label.length,
    ...rows.map((row) => csvCell(row[index]).length),
    column.kind === "datetime" ? 16 : 0,
  );
  return Math.min(40, Math.max(10, longest + 2));
}

/** An Excel workbook with readable headers and real numbers and dates, ready to sum and sort */
export async function toXlsx(table: ExportTable): Promise<Buffer> {
  const sheet: SheetData = [
    table.columns.map((column) => ({ value: column.label, fontWeight: "bold" as const })),
    ...table.rows.map((row) => table.columns.map((column, i) => xlsxCell(column, row[i]))),
  ];
  return writeExcelFile(sheet, {
    sheet: table.documentType,
    stickyRowsCount: 1,
    columns: table.columns.map((column, i) => ({ width: columnWidth(column, table.rows, i) })),
  }).toBuffer();
}

/** `uk-energy-bill-records-2026-10-31.csv` */
export function exportFilename(table: ExportTable, format: ExportFormat, now = new Date()): string {
  return `${table.documentType}-records-${now.toISOString().slice(0, 10)}.${format}`;
}
