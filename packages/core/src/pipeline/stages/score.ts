import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { documents, records, type FieldError } from "../../db/schema";
import { getDocumentType } from "../../document-types/registry";
import type { Extraction } from "../../extraction/extract";
import { validateExtraction } from "../../validation/validate";
import { PermanentPipelineError, type PipelineStage } from "../pipeline";

export const RUN_MISMATCH_RULE = "run-mismatch";

export interface ScoreSettings {
  /** Approve documents with no flags without a human; otherwise everything goes to review */
  autoApprove: boolean;
}

function normalise(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

/** Fields whose values are not identical across every run */
export function mismatchedFields(runs: readonly Record<string, unknown>[]): string[] {
  const fields = new Set(runs.flatMap((run) => Object.keys(run)));

  return [...fields].filter((field) => {
    const [first, ...rest] = runs.map((run) => normalise(run[field]));
    return rest.some((value) => !isDeepStrictEqual(value, first));
  });
}

/** Every validation error from every run, plus one flag per field the runs disagree on */
export function scoreExtractions(runs: readonly Extraction[]): FieldError[] {
  const flags = runs.flatMap((run) =>
    run.validationErrors.map((error) => ({
      ...error,
      message: `Run ${run.runNumber}: ${error.message}`,
    })),
  );
  const parsed = runs
    .map((run) => run.parsed)
    .filter((p): p is Record<string, unknown> => p !== null);

  // Compare only when every run produced an object; an unparsed run is already flagged
  if (parsed.length === runs.length && parsed.length > 1) {
    for (const field of mismatchedFields(parsed)) {
      const values = parsed.map((p) => JSON.stringify(p[field] ?? null)).join(" vs ");
      flags.push({ field, rule: RUN_MISMATCH_RULE, message: `Runs disagree: ${values}` });
    }
  }

  return flags;
}

export function createScoreStage(settings: ScoreSettings): PipelineStage {
  return {
    name: "score",
    async run(ctx) {
      const [primary] = ctx.extractions;

      // Nothing was extracted (e.g. a scan before the vision path): a human has to read it
      if (!primary) {
        return;
      }

      const flags = scoreExtractions(ctx.extractions);
      await ctx.deps.db.update(documents).set({ flags }).where(eq(documents.id, ctx.document.id));

      if (flags.length > 0 || !settings.autoApprove) {
        return;
      }

      const { slug, version } = ctx.documentType;
      const definition = getDocumentType(slug, version);
      const data = definition && validateExtraction(definition, primary.parsed).data;

      // Unreachable after a clean validate stage, but never approve data that is not schema-valid
      if (!data) {
        throw new PermanentPipelineError(`Cannot approve ${ctx.document.id}: data is not valid`);
      }

      // A retry after a crash may find the record already written
      await ctx.deps.db
        .insert(records)
        .values({
          documentId: ctx.document.id,
          extractionId: primary.id,
          documentTypeId: ctx.document.documentTypeId,
          data,
          approvedBy: "auto",
        })
        .onConflictDoNothing({ target: records.documentId });

      ctx.outcome = "approved";
    },
  };
}
