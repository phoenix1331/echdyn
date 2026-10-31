import { RUN_MISMATCH_RULE, type DocumentReview, type FieldDisplay } from "@echdyn/core";

export type IssueKind = "check" | "format" | "mismatch";

export interface FieldIssue {
  kind: IssueKind;
  message: string;
  /** Runs that raised it; shown when fewer than all of them did */
  runs: number[];
}

export type InputType = "text" | "number" | "date";

export interface ReviewField {
  key: string;
  label: string;
  description?: string;
  /** Formatted for reading; empty when the model found nothing */
  value: string;
  /** The value in the schema's units, ready to edit (e.g. "4055", "2026-08-02") */
  input: { value: string; type: InputType; unit?: string };
  /** Set on approved documents when a reviewer changed the value */
  corrected?: { from: string; by: string };
  /** What the model copied from the page, shown on flagged fields to compare with the PDF */
  printed?: string;
  issues: FieldIssue[];
}

export interface FailedCheck {
  message: string;
  /** Labels of the fields the check involves */
  fields: string[];
  runs: number[];
}

export interface ReviewView {
  fields: ReviewField[];
  /** Business rules that failed, once each, for the summary above the fields */
  checks: FailedCheck[];
  /** Problems with the run as a whole, such as output that was not JSON */
  general: string[];
  runCount: number;
  /** Who approved it; values then come from the record, and flags are history */
  approvedBy?: string;
}

type Property = { type?: unknown; format?: unknown; description?: unknown };

const RUN_PREFIX = /^Run (\d+): /;
const ACRONYMS: Record<string, string> = {
  vat: "VAT",
  kwh: "kWh",
  mpan: "MPAN",
  mprn: "MPRN",
  id: "ID",
};
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 4 });
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "standing_charge_pence_per_day" reads "Standing charge pence per day" */
export function humanise(key: string): string {
  const words = key.split("_").map((word) => ACRONYMS[word] ?? word);
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

export function formatValue(value: unknown, display?: FieldDisplay, format?: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "number") {
    if (display?.currency) {
      return GBP.format(value);
    }
    const unit = display?.unit;
    const number = NUMBER.format(value);
    if (!unit) {
      return number;
    }
    return unit === "%" ? `${number}%` : `${number} ${unit}`;
  }
  if (typeof value === "string") {
    if (format === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return DATE.format(new Date(`${value}T00:00:00Z`));
    }
    return value;
  }
  return JSON.stringify(value);
}

function inputValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function inputType(prop: Property): InputType {
  if (prop.type === "number" || prop.type === "integer") {
    return "number";
  }
  return prop.format === "date" ? "date" : "text";
}

function inputUnit(display?: FieldDisplay): string | undefined {
  return display?.currency ? "£" : display?.unit;
}

function properties(schema: Record<string, unknown>): Record<string, Property> {
  const value = schema.properties;
  return typeof value === "object" && value !== null ? (value as Record<string, Property>) : {};
}

/**
 * Turns stored flags into something a reviewer can act on: each problem once per field,
 * failed checks summarised once, and run disagreements shown with the other run's value.
 */
export function buildReview(
  review: DocumentReview,
  display: Readonly<Partial<Record<string, FieldDisplay>>> = {},
  order: readonly string[] = [],
): ReviewView {
  const props = properties(review.schema);
  // Postgres jsonb does not keep key order, so the definition's field order wins
  const keys = [
    ...order.filter((key) => key in props),
    ...Object.keys(props).filter((key) => !order.includes(key)),
  ];
  // Undefined before the first run finishes
  const primary = review.runs.at(0);
  const others = review.runs.slice(1);
  const labelOf = (key: string) => display[key]?.label ?? humanise(key);
  const issues = new Map<string, Map<string, FieldIssue>>();
  const checks = new Map<string, FailedCheck>();
  const general: string[] = [];
  const record = review.record;
  // Once approved, the flags explain what was checked, not what is left to do
  const flags = record ? [] : review.document.flags;
  const values = record?.data ?? primary?.parsed;
  const corrections = new Map(review.corrections.map((c) => [c.field, c]));

  for (const flag of flags) {
    const run = RUN_PREFIX.exec(flag.message);
    const runs = run ? [Number(run[1])] : [];
    const text = flag.message.replace(RUN_PREFIX, "");

    if (!(flag.field in props)) {
      if (!general.includes(text)) {
        general.push(text);
      }
      continue;
    }

    let issue: FieldIssue;
    if (flag.rule === RUN_MISMATCH_RULE) {
      const readings = others
        .filter((other) => other.parsed?.[flag.field] !== primary?.parsed?.[flag.field])
        .map((other) => {
          const value = formatValue(
            other.parsed?.[flag.field],
            display[flag.field],
            props[flag.field].format,
          );
          return `run ${String(other.runNumber)} read ${value || "nothing"}`;
        });
      issue = { kind: "mismatch", message: `The runs disagree: ${readings.join(", ")}`, runs: [] };
    } else {
      issue = { kind: flag.rule ? "check" : "format", message: text, runs };
    }

    const forField = issues.get(flag.field) ?? new Map<string, FieldIssue>();
    const key = `${issue.kind}|${issue.message}`;
    const existing = forField.get(key);
    if (existing) {
      existing.runs.push(...runs);
    } else {
      forField.set(key, issue);
    }
    issues.set(flag.field, forField);

    if (flag.rule && flag.rule !== RUN_MISMATCH_RULE) {
      const check = checks.get(text) ?? { message: text, fields: [], runs: [] };
      if (!check.fields.includes(labelOf(flag.field))) {
        check.fields.push(labelOf(flag.field));
      }
      for (const r of runs) {
        if (!check.runs.includes(r)) {
          check.runs.push(r);
        }
      }
      checks.set(text, check);
    }
  }

  const fields = keys.map((key): ReviewField => {
    const prop = props[key];
    const fieldIssues = [...(issues.get(key)?.values() ?? [])].map((issue) => ({
      ...issue,
      runs: [...new Set(issue.runs)].sort((a, b) => a - b),
    }));
    const value = formatValue(values?.[key], display[key], prop.format);
    const printed = primary?.printed?.[key];
    const showPrinted =
      fieldIssues.length > 0 && typeof printed === "string" && printed !== "" && printed !== value;
    const unit = inputUnit(display[key]);
    const correction = record ? corrections.get(key) : undefined;

    return {
      key,
      label: labelOf(key),
      ...(typeof prop.description === "string" ? { description: prop.description } : {}),
      value,
      input: {
        value: inputValue(primary?.parsed?.[key]),
        type: inputType(prop),
        ...(unit ? { unit } : {}),
      },
      ...(correction
        ? {
            corrected: {
              from: formatValue(correction.oldValue, display[key], prop.format) || "nothing",
              by: correction.reviewer,
            },
          }
        : {}),
      ...(showPrinted ? { printed } : {}),
      issues: fieldIssues,
    };
  });

  return {
    fields,
    checks: [...checks.values()],
    general,
    runCount: review.runs.length,
    ...(record ? { approvedBy: record.approvedBy } : {}),
  };
}
