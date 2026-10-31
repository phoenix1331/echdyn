import type { FieldError } from "@echdyn/core";

/** Form field names: `correct.<field>` carries a typed value for one field */
export const CORRECTION_PREFIX = "correct.";

export interface ApprovalRequest {
  corrections: Record<string, string>;
  overrideChecks: boolean;
  addToLabelledSet: boolean;
}

export interface ReviewState {
  /** Problems with a typed value, keyed by field */
  fieldErrors?: Record<string, string[]>;
  /** Problems not tied to one field, or with the request itself */
  general?: string[];
  /** Every remaining problem is a business rule, which the reviewer may approve past */
  canOverride?: boolean;
}

export function parseApprovalForm(form: FormData): ApprovalRequest {
  const corrections: Record<string, string> = {};

  for (const [name, value] of form.entries()) {
    if (name.startsWith(CORRECTION_PREFIX) && typeof value === "string") {
      corrections[name.slice(CORRECTION_PREFIX.length)] = value;
    }
  }

  return {
    corrections,
    overrideChecks: form.get("override") === "on",
    addToLabelledSet: form.get("label") === "on",
  };
}

/** Groups validation errors by field so the form can show each beside its input */
export function toReviewState(
  errors: readonly FieldError[],
  fields: readonly string[],
): ReviewState {
  const fieldErrors: Record<string, string[]> = {};
  const general: string[] = [];

  for (const error of errors) {
    if (!fields.includes(error.field)) {
      general.push(error.message);
      continue;
    }
    const list = (fieldErrors[error.field] ??= []);
    if (!list.includes(error.message)) {
      list.push(error.message);
    }
  }

  return {
    fieldErrors,
    general,
    canOverride: errors.length > 0 && errors.every((error) => error.rule !== undefined),
  };
}

/** Where to send the reviewer after approval; `labelled` reports the labelled set outcome */
export function approvedHref(documentId: string, labelled?: string | false): string {
  const base = `/documents/${documentId}`;
  if (labelled === undefined) {
    return base;
  }
  return `${base}?labelled=${encodeURIComponent(labelled || "failed")}`;
}
