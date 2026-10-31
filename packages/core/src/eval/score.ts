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
  /** The label's layout, or its source when it has none */
  layout: string;
  /** The labelled set it came from, e.g. synthetic or scanned */
  set: string;
  /** The model that wrote the primary run: the text or the vision model; null when none ran */
  readBy: string | null;
  outcome: EvalOutcome;
  durationMs: number;
  fields: Record<string, FieldResult>;
  error?: string;
}

export interface LayoutSummary {
  documents: number;
  fieldAccuracy: number;
  documentAccuracy: number;
  flaggedShare: number;
}

export interface SetSummary extends LayoutSummary {
  /** Models that read the set's documents, usually one */
  readBy: string[];
  medianDurationMs: number;
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
  /** Shows which templates a model struggles with, which overall accuracy hides */
  byLayout: Record<string, LayoutSummary>;
  /** Text and scans apart: blending them would hide how each path does */
  bySet: Record<string, SetSummary>;
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
const allCorrect = (r: DocumentResult) => Object.values(r.fields).every((f) => f.correct);

function summariseLayout(results: readonly DocumentResult[]): LayoutSummary {
  const fieldResults = results.flatMap((r) => Object.values(r.fields));
  return {
    documents: results.length,
    fieldAccuracy: share(fieldResults.filter((f) => f.correct).length, fieldResults.length),
    documentAccuracy: share(results.filter(allCorrect).length, results.length),
    flaggedShare: share(results.filter((r) => r.outcome === "needs_review").length, results.length),
  };
}

export function summarise(model: string, results: readonly DocumentResult[]): ModelSummary {
  const fieldResults = results.flatMap((r) => Object.entries(r.fields));
  const fieldNames = [...new Set(fieldResults.map(([field]) => field))];
  const approved = results.filter((r) => r.outcome === "approved");
  const layouts = [...new Set(results.map((r) => r.layout))].sort();
  const sets = [...new Set(results.map((r) => r.set))];

  return {
    model,
    ...summariseLayout(results),
    accuracyByField: Object.fromEntries(
      fieldNames.map((name) => {
        const forField = fieldResults.filter(([field]) => field === name);
        return [name, share(forField.filter(([, f]) => f.correct).length, forField.length)];
      }),
    ),
    autoApproved: approved.length,
    approvedWithErrors: approved.filter((r) => !allCorrect(r)).length,
    failed: results.filter((r) => r.outcome === "failed").length,
    medianDurationMs: median(results.map((r) => r.durationMs)),
    byLayout: Object.fromEntries(
      layouts.map((layout) => [
        layout,
        summariseLayout(results.filter((r) => r.layout === layout)),
      ]),
    ),
    bySet: Object.fromEntries(
      sets.map((set) => {
        const inSet = results.filter((r) => r.set === set);
        return [
          set,
          {
            ...summariseLayout(inSet),
            readBy: [...new Set(inSet.flatMap((r) => (r.readBy ? [r.readBy] : [])))],
            medianDurationMs: median(inSet.map((r) => r.durationMs)),
          },
        ];
      }),
    ),
  };
}
