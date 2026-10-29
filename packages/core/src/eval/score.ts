import { isDeepStrictEqual } from "node:util";

export type EvalOutcome = "approved" | "needs_review" | "failed";

export interface FieldResult {
  expected: unknown;
  actual: unknown;
  correct: boolean;
}

export interface DocumentResult {
  id: string;
  model: string;
  outcome: EvalOutcome;
  durationMs: number;
  fields: Record<string, FieldResult>;
  error?: string;
}

export interface ModelSummary {
  model: string;
  documents: number;
  /** Correct fields / all fields */
  fieldAccuracy: number;
  /** Documents with every field correct */
  documentAccuracy: number;
  accuracyByField: Record<string, number>;
  flaggedShare: number;
  autoApproved: number;
  /** Auto-approved documents with at least one wrong field: the errors nobody would see */
  approvedWithErrors: number;
  failed: number;
  medianDurationMs: number;
}

/** Exact match, except text ignores case and surrounding whitespace (logos are often in capitals) */
export function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "number") {
    return typeof actual === "number" && Math.abs(expected - actual) < 1e-9;
  }
  if (typeof expected === "string") {
    return (
      typeof actual === "string" && expected.trim().toLowerCase() === actual.trim().toLowerCase()
    );
  }
  return isDeepStrictEqual(expected, actual);
}

export function scoreFields(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | null,
): Record<string, FieldResult> {
  return Object.fromEntries(
    Object.entries(expected).map(([field, value]) => {
      const got = actual?.[field];
      return [field, { expected: value, actual: got ?? null, correct: valuesMatch(value, got) }];
    }),
  );
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

const share = (count: number, total: number) => (total === 0 ? 0 : count / total);

export function summarise(model: string, results: readonly DocumentResult[]): ModelSummary {
  const fieldResults = results.flatMap((r) => Object.entries(r.fields));
  const fieldNames = [...new Set(fieldResults.map(([field]) => field))];
  const allCorrect = (r: DocumentResult) => Object.values(r.fields).every((f) => f.correct);
  const approved = results.filter((r) => r.outcome === "approved");

  return {
    model,
    documents: results.length,
    fieldAccuracy: share(fieldResults.filter(([, f]) => f.correct).length, fieldResults.length),
    documentAccuracy: share(results.filter(allCorrect).length, results.length),
    accuracyByField: Object.fromEntries(
      fieldNames.map((name) => {
        const forField = fieldResults.filter(([field]) => field === name);
        return [name, share(forField.filter(([, f]) => f.correct).length, forField.length)];
      }),
    ),
    flaggedShare: share(results.filter((r) => r.outcome === "needs_review").length, results.length),
    autoApproved: approved.length,
    approvedWithErrors: approved.filter((r) => !allCorrect(r)).length,
    failed: results.filter((r) => r.outcome === "failed").length,
    medianDurationMs: median(results.map((r) => r.durationMs)),
  };
}
