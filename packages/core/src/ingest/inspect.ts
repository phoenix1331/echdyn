import { and, eq, inArray, sql } from "drizzle-orm";
import { InvalidPDFException } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Database } from "../db/client";
import { documents, extractions, type DocumentStatus, type PageKind } from "../db/schema";
import { ACTIVE_STATUSES, estimateProcessingMs } from "../documents/queries";
import { extractPdfText } from "../pipeline/stages/pre-process";
import { MAX_RENDERED_PAGES } from "../pipeline/stages/render";
import { checkUpload, IngestError, latestDocumentType, sha256Of, type IngestInput } from "./ingest";

/** Which model reads the document: decided by its page kinds, as the pipeline will */
export type ReadPath = "text" | "vision" | "mixed" | "none";

export interface PathEstimates {
  text: number | null;
  vision: number | null;
  mixed: number | null;
}

export interface Inspection {
  filename: string;
  sizeBytes: number;
  pageCount: number;
  pageKinds: PageKind[];
  path: ReadPath;
  /** Recent median for this path, scaled by scanned pages; null with no history yet */
  estimatedMs: number | null;
  /** Scanned pages beyond the render cap are not read */
  pagesNotRead: number;
  duplicate: {
    id: string;
    filename: string;
    status: DocumentStatus;
    createdAt: Date;
  } | null;
}

export interface QueueState {
  /** Documents queued or being processed now */
  ahead: number;
  estimatedWaitMs: number | null;
}

export function readPath(kinds: readonly PageKind[]): ReadPath {
  const typed = kinds.includes("text");
  const scanned = kinds.includes("scan");
  if (typed && scanned) {
    return "mixed";
  }
  if (scanned) {
    return "vision";
  }
  return typed ? "text" : "none";
}

/**
 * Median whole-document extraction time per path over each path's most recent documents.
 * The path comes from the prompt version (`text-v2`, `vision-v2`, `mixed-v1`), so a scan on
 * CPU (minutes) never drags the estimate for a typed PDF (seconds).
 */
export async function estimateByPath(db: Database, sample = 20): Promise<PathEstimates> {
  const rows = await db.execute<{ path: string; median: number | null }>(sql`
    select path, percentile_cont(0.5) within group (order by total)::float8 as median
    from (
      select path, total, row_number() over (partition by path order by finished desc) as recent
      from (
        select
          split_part(min(${extractions.promptVersion}), '-', 1) as path,
          sum(${extractions.durationMs}) as total,
          max(${extractions.createdAt}) as finished
        from ${extractions}
        group by ${extractions.documentId}
      ) per_document
    ) ranked
    where recent <= ${sample}
    group by path
  `);
  const median = (path: string) => {
    const value = rows.find((row) => row.path === path)?.median;
    return value === null || value === undefined ? null : Math.round(value);
  };

  return { text: median("text"), vision: median("vision"), mixed: median("mixed") };
}

export async function queueState(db: Database): Promise<QueueState> {
  const [row] = await db
    .select({ ahead: sql<number>`count(*)::int` })
    .from(documents)
    .where(inArray(documents.status, [...ACTIVE_STATUSES]));
  const ahead = row?.ahead ?? 0;
  const each = ahead > 0 ? await estimateProcessingMs(db) : null;

  return { ahead, estimatedWaitMs: each === null ? null : each * ahead };
}

function estimateFor(path: ReadPath, estimates: PathEstimates, scansRead: number): number | null {
  if (path === "text") {
    return estimates.text;
  }
  if (path === "none") {
    return null;
  }
  // Vision time is mostly reading each page image, so it grows with the scanned pages read;
  // with no history for this path, the other vision path is the nearest guide
  const perScan = estimates[path] ?? estimates.vision ?? estimates.mixed;
  return perScan === null ? null : Math.round(perScan * scansRead);
}

/**
 * What uploading this file would do, without storing or queueing anything: the same checks
 * as ingest, the duplicate it would resolve to, how each page will be read, and roughly how
 * long that takes here. Throws IngestError for a file ingest would refuse.
 */
export async function inspectDocument(db: Database, input: IngestInput): Promise<Inspection> {
  checkUpload(input.bytes);
  const documentType = await latestDocumentType(db, input.documentTypeSlug);

  let text;
  try {
    text = await extractPdfText(input.bytes);
  } catch (error) {
    if (error instanceof InvalidPDFException) {
      throw new IngestError("unreadable_pdf", `Could not read the PDF: ${error.message}`);
    }
    throw error;
  }

  const [duplicate] = await db
    .select({
      id: documents.id,
      filename: documents.originalFilename,
      status: documents.status,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.documentTypeId, documentType.id),
        eq(documents.sha256, sha256Of(input.bytes)),
      ),
    );

  const path = readPath(text.pageKinds);
  const scanned = text.pageKinds.filter((kind) => kind === "scan").length;
  const read = Math.min(scanned, MAX_RENDERED_PAGES);
  const estimatedMs = estimateFor(path, await estimateByPath(db), read);

  return {
    filename: input.filename,
    sizeBytes: input.bytes.byteLength,
    pageCount: text.pageCount,
    pageKinds: text.pageKinds,
    path,
    estimatedMs,
    pagesNotRead: scanned - read,
    duplicate: duplicate ?? null,
  };
}
