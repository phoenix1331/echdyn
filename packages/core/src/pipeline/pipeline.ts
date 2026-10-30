import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { documents, documentTypes } from "../db/schema";
import type { Extraction } from "../extraction/extract";
import type { Storage } from "../storage/storage";
import type { PdfText } from "./stages/pre-process";
import { transitionStatus } from "./status";

export type Document = typeof documents.$inferSelect;
export type DocumentTypeRow = typeof documentTypes.$inferSelect;

export interface PipelineDependencies {
  db: Database;
  storage: Storage;
}

export interface PipelineContext {
  deps: PipelineDependencies;
  document: Document;
  documentType: DocumentTypeRow;
  file: Uint8Array;
  /** Set by the pre-process stage */
  text?: PdfText;
  /** Model runs so far, in order */
  extractions: Extraction[];
  /** Final status when every stage succeeds; stages may promote it to "approved" */
  outcome: "needs_review" | "approved";
}

export interface PipelineStage {
  name: string;
  /** Shown to the user while the stage runs; defaults to `name` */
  label?: string;
  run: (ctx: PipelineContext) => Promise<void>;
}

export type PipelineLogger = (message: string) => void;

/** A problem retrying cannot fix (missing document or file): fail immediately */
export class PermanentPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentPipelineError";
  }
}

/** A label used more than once is numbered, so two extraction runs read "(run 1 of 2)" */
export function stageLabels(stages: readonly PipelineStage[]): string[] {
  const labels = stages.map((stage) => stage.label ?? stage.name);
  const seen = new Map<string, number>();

  return labels.map((label) => {
    const total = labels.filter((l) => l === label).length;
    if (total === 1) {
      return label;
    }
    const run = (seen.get(label) ?? 0) + 1;
    seen.set(label, run);
    return `${label} (run ${String(run)} of ${String(total)})`;
  });
}

async function loadContext(
  deps: PipelineDependencies,
  documentId: string,
): Promise<PipelineContext> {
  const [row] = await deps.db
    .select({ document: documents, documentType: documentTypes })
    .from(documents)
    .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
    .where(eq(documents.id, documentId));

  if (!row) {
    throw new PermanentPipelineError(`Document ${documentId} does not exist`);
  }

  const file = await deps.storage.get(row.document.storageKey);

  if (!file) {
    throw new PermanentPipelineError(`File ${row.document.storageKey} is missing from storage`);
  }

  return { deps, ...row, file, extractions: [], outcome: "needs_review" };
}

/**
 * Runs every stage for one document. Status goes queued -> extracting -> outcome.
 * Errors propagate so the queue can retry; the caller decides when a failure is final.
 */
export async function processDocument(
  deps: PipelineDependencies,
  documentId: string,
  stages: readonly PipelineStage[],
  log: PipelineLogger = () => undefined,
): Promise<PipelineContext["outcome"]> {
  const ctx = await loadContext(deps, documentId);

  // A retry after a crash finds the document still "extracting"; carry on from there
  if (ctx.document.status !== "extracting") {
    await transitionStatus(deps.db, documentId, "extracting");
  }

  const labels = stageLabels(stages);
  for (const [index, stage] of stages.entries()) {
    await deps.db
      .update(documents)
      .set({ stage: labels[index] })
      .where(eq(documents.id, documentId));
    const started = performance.now();
    await stage.run(ctx);
    log(`${documentId} ${stage.name} ${Math.round(performance.now() - started)}ms`);
  }

  await transitionStatus(deps.db, documentId, ctx.outcome);
  return ctx.outcome;
}
