import { and, asc, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { corrections, documents, documentTypes, records } from "../db/schema";
import type { FieldFilter, FieldOperator, RecordQuery } from "./query";

export interface RecordSummary {
  id: string;
  documentId: string;
  filename: string;
  documentType: { slug: string; name: string; version: number };
  data: Record<string, unknown>;
  approvedBy: string;
  approvedAt: Date;
}

export interface RecordPage {
  items: RecordSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface RecordDetail extends RecordSummary {
  extractionId: string;
  /** What reviewers changed before approving, oldest first: the audit trail */
  corrections: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reviewer: string;
    createdAt: Date;
  }[];
}

// Fixed SQL for each operator: user input never becomes SQL text, only bound values
const COMPARE: Record<Exclude<FieldOperator, "contains">, SQL> = {
  eq: sql.raw("="),
  ne: sql.raw("<>"),
  gt: sql.raw(">"),
  gte: sql.raw(">="),
  lt: sql.raw("<"),
  lte: sql.raw("<="),
};

/**
 * One field filter as SQL on `records.data`. The field name is bound as a parameter of
 * `->>` and has already been checked against the type's schema; numbers compare as numeric,
 * dates as their ISO text, which sorts by date.
 */
function fieldCondition({ field, operator, value, kind }: FieldFilter): SQL {
  const text = sql`${records.data} ->> ${field}`;
  if (operator === "contains") {
    const escaped = String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
    return sql`${text} ilike ${`%${escaped}%`}`;
  }
  if (kind === "number") {
    return sql`(${text})::numeric ${COMPARE[operator]} ${value}`;
  }
  return sql`${text} ${COMPARE[operator]} ${value}`;
}

function nextDay(day: string): Date {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function conditions(query: Omit<RecordQuery, "page" | "pageSize">): SQL[] {
  const where: SQL[] = [];
  if (query.documentType) {
    where.push(eq(documentTypes.slug, query.documentType));
  }
  if (query.approvedFrom) {
    where.push(gte(records.approvedAt, new Date(`${query.approvedFrom}T00:00:00Z`)));
  }
  if (query.approvedTo) {
    where.push(lt(records.approvedAt, nextDay(query.approvedTo)));
  }
  return [...where, ...query.fields.map(fieldCondition)];
}

const summary = {
  id: records.id,
  documentId: records.documentId,
  filename: documents.originalFilename,
  slug: documentTypes.slug,
  typeName: documentTypes.name,
  typeVersion: documentTypes.version,
  data: records.data,
  approvedBy: records.approvedBy,
  approvedAt: records.approvedAt,
  extractionId: records.extractionId,
};

type SummaryRow = {
  id: string;
  documentId: string;
  filename: string;
  slug: string;
  typeName: string;
  typeVersion: number;
  data: Record<string, unknown>;
  approvedBy: string;
  approvedAt: Date;
};

function toSummary(row: SummaryRow): RecordSummary {
  return {
    id: row.id,
    documentId: row.documentId,
    filename: row.filename,
    documentType: { slug: row.slug, name: row.typeName, version: row.typeVersion },
    data: row.data,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
  };
}

function joined(db: Database) {
  return db
    .select(summary)
    .from(records)
    .innerJoin(documents, eq(records.documentId, documents.id))
    .innerJoin(documentTypes, eq(records.documentTypeId, documentTypes.id));
}

/** Approved records, newest first, filtered by type, approval date and field values */
export async function listRecords(db: Database, query: RecordQuery): Promise<RecordPage> {
  const where = and(...conditions(query));
  const [rows, [totals]] = await Promise.all([
    joined(db)
      .where(where)
      .orderBy(desc(records.approvedAt), desc(records.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(records)
      .innerJoin(documentTypes, eq(records.documentTypeId, documentTypes.id))
      .where(where),
  ]);

  const total = totals?.total ?? 0;
  return {
    items: rows.map(toSummary),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** One record with the run it came from and every correction made on the way */
export async function getRecord(db: Database, id: string): Promise<RecordDetail | null> {
  // Not a uuid: no such record, rather than a database error
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return null;
  }
  const [row] = await joined(db).where(eq(records.id, id));
  if (!row) {
    return null;
  }

  const trail = await db
    .select({
      field: corrections.field,
      oldValue: corrections.oldValue,
      newValue: corrections.newValue,
      reviewer: corrections.reviewer,
      createdAt: corrections.createdAt,
    })
    .from(corrections)
    .where(eq(corrections.documentId, row.documentId))
    .orderBy(asc(corrections.createdAt));

  return { ...toSummary(row), extractionId: row.extractionId, corrections: trail };
}
