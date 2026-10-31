import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  documents,
  documentStatus,
  documentTypes,
  extractions,
  type DocumentStatus,
} from "../db/schema";

export const DOCUMENT_STATUSES = documentStatus.enumValues;

/** Statuses the list keeps polling for, as they change without the reviewer doing anything */
export const ACTIVE_STATUSES: readonly DocumentStatus[] = ["queued", "extracting"];

export const DEFAULT_PAGE_SIZE = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DocumentFilters {
  status?: DocumentStatus;
  /** Document type slug, any version */
  documentType?: string;
  /** Matched against the original filename, case-insensitively */
  search?: string;
  /** 1-based */
  page?: number;
  pageSize?: number;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  documentType: { slug: string; name: string; version: number };
  status: DocumentStatus;
  stage: string | null;
  error: string | null;
  /** Distinct fields flagged for a person to check */
  flagCount: number;
  pageCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  /** Documents the worker will finish first; null unless queued */
  queueAhead: number | null;
}

export interface DocumentPage {
  items: DocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const summaryColumns = {
  id: documents.id,
  filename: documents.originalFilename,
  slug: documentTypes.slug,
  typeName: documentTypes.name,
  typeVersion: documentTypes.version,
  status: documents.status,
  stage: documents.stage,
  error: documents.error,
  // Distinct fields, not flags: one field can fail a rule and a run comparison at once
  flagCount:
    sql<number>`(select count(distinct f->>'field') from jsonb_array_elements(${documents.flags}) f)`.mapWith(
      Number,
    ),
  pageCount: documents.pageCount,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

function selectSummaries(db: Database) {
  return db
    .select(summaryColumns)
    .from(documents)
    .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
    .$dynamic();
}

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number];

/**
 * Active documents in the order the worker takes them (oldest first; one at a time).
 * Approximate when a retry is waiting out its backoff, which is fine for a progress hint.
 */
async function activeQueue(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(inArray(documents.status, [...ACTIVE_STATUSES]))
    .orderBy(asc(documents.createdAt), asc(documents.id));
  return new Map(rows.map((row, index) => [row.id, index]));
}

function toSummary(row: SummaryRow, queue: Map<string, number>): DocumentSummary {
  const { slug, typeName, typeVersion, ...rest } = row;
  return {
    ...rest,
    documentType: { slug, name: typeName, version: typeVersion },
    queueAhead: row.status === "queued" ? (queue.get(row.id) ?? null) : null,
  };
}

/** Escapes LIKE wildcards so a search for "50%" means the characters, not a pattern */
function likeContains(search: string): string {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

function filterConditions({ status, documentType, search }: DocumentFilters): SQL[] {
  const conditions: SQL[] = [];
  if (status) {
    conditions.push(eq(documents.status, status));
  }
  if (documentType) {
    conditions.push(eq(documentTypes.slug, documentType));
  }
  if (search?.trim()) {
    conditions.push(ilike(documents.originalFilename, likeContains(search.trim())));
  }
  return conditions;
}

export async function listDocuments(
  db: Database,
  filters: DocumentFilters = {},
): Promise<DocumentPage> {
  const { page = 1, pageSize = DEFAULT_PAGE_SIZE } = filters;
  const where = and(...filterConditions(filters));
  const current = Math.max(1, Math.floor(page));

  const [rows, [totals], queue] = await Promise.all([
    selectSummaries(db)
      .where(where)
      .orderBy(desc(documents.createdAt), desc(documents.id))
      .limit(pageSize)
      .offset((current - 1) * pageSize),
    db
      .select({ total: count() })
      .from(documents)
      .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
      .where(where),
    activeQueue(db),
  ]);

  const total = totals?.total ?? 0;
  return {
    items: rows.map((row) => toSummary(row, queue)),
    total,
    page: current,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * How many documents match the other filters in each status, for status tabs.
 * Ignores `status` itself, so every tab shows its own count whichever is selected.
 */
export async function countDocumentsByStatus(
  db: Database,
  filters: Omit<DocumentFilters, "status" | "page" | "pageSize"> = {},
): Promise<Record<DocumentStatus, number>> {
  const rows = await db
    .select({ status: documents.status, total: count() })
    .from(documents)
    .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
    .where(and(...filterConditions(filters)))
    .groupBy(documents.status);

  const counts = Object.fromEntries(DOCUMENT_STATUSES.map((s) => [s, 0])) as Record<
    DocumentStatus,
    number
  >;
  for (const { status, total } of rows) {
    counts[status] = total;
  }
  return counts;
}

/** One document's progress, or null when the id is unknown (or not a UUID) */
export async function getDocumentSummary(
  db: Database,
  id: string,
): Promise<DocumentSummary | null> {
  if (!UUID.test(id)) {
    return null;
  }

  const [[row], queue] = await Promise.all([
    selectSummaries(db).where(eq(documents.id, id)),
    activeQueue(db),
  ]);

  return row ? toSummary(row, queue) : null;
}

/** The latest version of each document type, for filter menus */
export async function listDocumentTypeOptions(
  db: Database,
): Promise<{ slug: string; name: string }[]> {
  const rows = await db
    .selectDistinctOn([documentTypes.slug], { slug: documentTypes.slug, name: documentTypes.name })
    .from(documentTypes)
    .orderBy(asc(documentTypes.slug), desc(documentTypes.version));
  return rows;
}

/**
 * Median time spent in model runs per document over the most recent ones, in ms.
 * Extraction dominates pipeline time, so this is what "usually takes about" quotes.
 * Null until something has been processed.
 */
export async function estimateProcessingMs(db: Database, sample = 20): Promise<number | null> {
  const rows = await db.execute<{ median: number | null }>(sql`
    select percentile_cont(0.5) within group (order by total)::float8 as median
    from (
      select sum(${extractions.durationMs}) as total
      from ${extractions}
      group by ${extractions.documentId}
      order by max(${extractions.createdAt}) desc
      limit ${sample}
    ) recent
  `);
  const median = rows[0]?.median;
  return median === null || median === undefined ? null : Math.round(median);
}
