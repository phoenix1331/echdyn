import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { firstRow } from "../db/rows";
import {
  corrections,
  documents,
  documentTypes,
  extractions,
  records,
  type FieldError,
  type PageKind,
} from "../db/schema";
import { getDocumentSummary, type DocumentSummary } from "./queries";

export interface ReviewRun {
  runNumber: number;
  model: string;
  promptVersion: string;
  /** Values in the schema's units, or null when the output was not JSON */
  parsed: Record<string, unknown> | null;
  /** The values as the model copied them from the page, before unit conversion */
  printed: Record<string, unknown> | null;
  validationErrors: FieldError[];
  durationMs: number;
  createdAt: Date;
}

export interface ReviewCorrection {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reviewer: string;
  createdAt: Date;
}

export interface ReviewRecord {
  id: string;
  data: Record<string, unknown>;
  approvedBy: string;
  approvedAt: Date;
}

export interface DocumentReview {
  document: DocumentSummary & {
    storageKey: string;
    hasTextLayer: boolean | null;
    pageKinds: PageKind[] | null;
    flags: FieldError[];
  };
  /** The JSON Schema stored with the document type version, which fixes field order */
  schema: Record<string, unknown>;
  runs: ReviewRun[];
  /** The approved values, once a reviewer or auto-approval has signed them off */
  record: ReviewRecord | null;
  corrections: ReviewCorrection[];
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Everything the review screen shows for one document, or null when it does not exist.
 * A retried job can store a run number twice; the latest attempt wins.
 */
export async function getDocumentReview(db: Database, id: string): Promise<DocumentReview | null> {
  const summary = await getDocumentSummary(db, id);
  if (!summary) {
    return null;
  }

  const [extraRows, rows, recordRows, correctionRows] = await Promise.all([
    db
      .select({
        storageKey: documents.storageKey,
        hasTextLayer: documents.hasTextLayer,
        pageKinds: documents.pageKinds,
        flags: documents.flags,
        schema: documentTypes.schema,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
      .where(eq(documents.id, id)),
    db
      .select()
      .from(extractions)
      .where(eq(extractions.documentId, id))
      .orderBy(asc(extractions.createdAt), asc(extractions.runNumber)),
    db
      .select({
        id: records.id,
        data: records.data,
        approvedBy: records.approvedBy,
        approvedAt: records.approvedAt,
      })
      .from(records)
      .where(eq(records.documentId, id)),
    db
      .select({
        field: corrections.field,
        oldValue: corrections.oldValue,
        newValue: corrections.newValue,
        reviewer: corrections.reviewer,
        createdAt: corrections.createdAt,
      })
      .from(corrections)
      .where(eq(corrections.documentId, id))
      .orderBy(asc(corrections.createdAt)),
  ]);

  // The summary query has just found this row
  const extra = firstRow(extraRows, "document review");
  const latest = new Map(rows.map((row) => [row.runNumber, row]));
  const runs = [...latest.values()]
    .sort((a, b) => a.runNumber - b.runNumber)
    .map((row) => ({
      runNumber: row.runNumber,
      model: row.model,
      promptVersion: row.promptVersion,
      parsed: row.parsed,
      printed: parseObject(row.rawOutput),
      validationErrors: row.validationErrors,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
    }));

  const { schema, ...documentExtra } = extra;
  return {
    document: { ...summary, ...documentExtra },
    schema,
    runs,
    record: recordRows[0] ?? null,
    corrections: correctionRows,
  };
}
