import type { DocumentReview, FieldDisplay } from "@echdyn/core";
import { describePages } from "@/lib/upload/summary";
import type { ReviewField } from "@/lib/review/fields";
import { formatValue } from "@/lib/review/fields";

export interface AuditEvent {
  at: Date;
  title: string;
  detail?: string;
  /** Something a person had to look at or change */
  attention?: boolean;
}

export interface Reading {
  key: string;
  label: string;
  /** What each run read, formatted; empty when it read nothing */
  runs: string[];
  approved: string;
  /** The runs disagreed, or the approved value is not what run 1 read */
  differs: boolean;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/**
 * From upload to approval in order: what was read, by which model and prompt, what the checks
 * found, what a person changed, and who signed it off. The record's provenance on one page.
 */
export function auditTimeline(
  review: DocumentReview,
  labelOf: (key: string) => string,
): AuditEvent[] {
  const { document, runs, record, corrections } = review;
  const events: AuditEvent[] = [
    {
      at: document.createdAt,
      title: `Uploaded ${document.filename}`,
      ...(document.pageKinds ? { detail: describePages(document.pageKinds) } : {}),
    },
    ...runs.map((run) => ({
      at: run.createdAt,
      title: `Run ${String(run.runNumber)} read by ${run.model}`,
      detail: `Prompt ${run.promptVersion}, ${seconds(run.durationMs)}${run.parsed ? "" : ", output was not usable JSON"}`,
      ...(run.parsed ? {} : { attention: true }),
    })),
  ];

  const lastRun = runs.at(-1)?.createdAt ?? document.createdAt;
  const flagged = [...new Set(document.flags.map((flag) => flag.field))];
  events.push(
    flagged.length > 0
      ? {
          at: lastRun,
          title: `Checks flagged ${plural(flagged.length, "field")} for review`,
          detail: flagged.map(labelOf).join(", "),
          attention: true,
        }
      : { at: lastRun, title: "Every check passed and the runs agreed" },
  );

  for (const correction of corrections) {
    events.push({
      at: correction.createdAt,
      title: `${correction.reviewer} corrected ${labelOf(correction.field)}`,
      detail: `${JSON.stringify(correction.oldValue)} to ${JSON.stringify(correction.newValue)}`,
      attention: true,
    });
  }

  if (record) {
    events.push({
      at: record.approvedAt,
      title:
        record.approvedBy === "auto"
          ? "Approved automatically"
          : `Approved by ${record.approvedBy}`,
    });
  }

  // Stable for equal times: the order above is the order things happen in
  return events
    .map((event, i) => ({ event, i }))
    .sort((a, b) => a.event.at.getTime() - b.event.at.getTime() || a.i - b.i)
    .map(({ event }) => event);
}

/** Field by field: what each run read beside what was approved, so a difference stands out */
export function readings(
  review: DocumentReview,
  fields: readonly ReviewField[],
  display: Readonly<Partial<Record<string, FieldDisplay>>> = {},
): Reading[] {
  const properties = (review.schema.properties ?? {}) as Partial<
    Record<string, { format?: unknown }>
  >;

  return fields.map((field) => {
    const format = properties[field.key]?.format;
    const read = review.runs.map((run) => run.parsed?.[field.key]);
    const runs = read.map((value) => formatValue(value, display[field.key], format));
    const approved = review.record?.data[field.key];
    const disagree = runs.some((value) => value !== runs[0]);
    const changed = JSON.stringify(approved ?? null) !== JSON.stringify(read[0] ?? null);
    return {
      key: field.key,
      label: field.label,
      runs,
      approved: field.value,
      differs: disagree || changed,
    };
  });
}
