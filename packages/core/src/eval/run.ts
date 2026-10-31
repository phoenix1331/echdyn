import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrateDatabase, resetDatabase } from "../db/migrate";
import { extractions } from "../db/schema";
import { seedDocumentTypes } from "../document-types/seed";
import type { ChatClient } from "../extraction/extract";
import { ingestDocument } from "../ingest/ingest";
import { processDocument, type PipelineDependencies } from "../pipeline/pipeline";
import { createPipelineStages } from "../pipeline/stages/default";
import type { DocumentQueue } from "../queue/queue";
import type { LabelledDocument } from "./labelled-set";
import { scoreFields, summarise, type DocumentResult, type ModelSummary } from "./score";

export interface EvalOptions {
  documents: readonly LabelledDocument[];
  /** Each candidate reads every text document */
  models: readonly string[];
  /** Reads every scan, whichever text model is being measured */
  visionModel?: string;
  /** Must point at a dedicated eval database: it is reset before each model */
  deps: PipelineDependencies;
  client: ChatClient;
  autoApprove?: boolean;
  onProgress?: (message: string) => void;
}

export interface EvalRun {
  summaries: ModelSummary[];
  results: DocumentResult[];
}

// The eval calls the pipeline directly, so nothing needs to be queued
const noQueue = { add: () => Promise.resolve() } as unknown as DocumentQueue;

export async function runEval({
  documents,
  models,
  visionModel,
  deps,
  client,
  autoApprove = true,
  onProgress = () => undefined,
}: EvalOptions): Promise<EvalRun> {
  const results: DocumentResult[] = [];
  const summaries: ModelSummary[] = [];

  for (const model of models) {
    // A clean database per model, so duplicate detection never skips a document
    await resetDatabase(deps.db);
    await migrateDatabase(deps.db);
    await seedDocumentTypes(deps.db);

    const stages = createPipelineStages({
      client,
      textModel: model,
      ...(visionModel ? { visionModel } : {}),
      autoApprove,
    });
    const modelResults: DocumentResult[] = [];

    for (const [index, labelled] of documents.entries()) {
      const bytes = new Uint8Array(await readFile(labelled.pdfPath));
      const { id } = await ingestDocument(
        { ...deps, queue: noQueue },
        { documentTypeSlug: labelled.documentType, filename: basename(labelled.pdfPath), bytes },
      );

      const started = performance.now();
      let outcome: DocumentResult["outcome"];
      let error: string | undefined;
      try {
        outcome = await processDocument(deps, id, stages);
      } catch (e) {
        outcome = "failed";
        error = e instanceof Error ? e.message : String(e);
      }
      const durationMs = Math.round(performance.now() - started);

      // Score the primary run: it is what gets approved, and what a reviewer starts from
      const [primary] = await deps.db
        .select({ parsed: extractions.parsed, model: extractions.model })
        .from(extractions)
        .where(and(eq(extractions.documentId, id), eq(extractions.runNumber, 1)));

      const result: DocumentResult = {
        id: labelled.id,
        model,
        layout: labelled.layout ?? labelled.source,
        set: labelled.set,
        readBy: primary?.model ?? null,
        outcome,
        durationMs,
        fields: scoreFields(labelled.expected, primary?.parsed ?? null),
        ...(error === undefined ? {} : { error }),
      };
      modelResults.push(result);

      const correct = Object.values(result.fields).filter((f) => f.correct).length;
      onProgress(
        `${model} ${String(index + 1)}/${String(documents.length)} ${labelled.id}: ${outcome}, ${String(correct)}/${String(Object.keys(result.fields).length)} fields, ${(durationMs / 1000).toFixed(1)} s`,
      );
    }

    results.push(...modelResults);
    summaries.push(summarise(model, modelResults));
  }

  return { summaries, results };
}
