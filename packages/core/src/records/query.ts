import { getDocumentType, toJsonSchema } from "../document-types/registry";

export type FieldOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
export type FieldKind = "number" | "date" | "text";

export interface FieldFilter {
  field: string;
  operator: FieldOperator;
  value: string | number;
  kind: FieldKind;
}

export interface RecordQuery {
  /** Document type slug; required for field filters, which are checked against its schema */
  documentType?: string;
  /** Matched, case-insensitively, against the file name and every value in the record */
  search?: string;
  /** Approved on or after this day (YYYY-MM-DD) */
  approvedFrom?: string;
  /** Approved on or before this day, inclusive */
  approvedTo?: string;
  fields: FieldFilter[];
  page: number;
  pageSize: number;
}

/** A query a caller can fix: reported as 422 with this message */
export class RecordQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordQueryError";
  }
}

export const DEFAULT_RECORD_PAGE_SIZE = 25;
export const MAX_RECORD_PAGE_SIZE = 100;

const OPERATORS: Record<FieldKind, readonly FieldOperator[]> = {
  number: ["eq", "ne", "gt", "gte", "lt", "lte"],
  // ISO dates sort as text, so ranges work on them too
  date: ["eq", "ne", "gt", "gte", "lt", "lte"],
  text: ["eq", "ne", "contains"],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

type Property = { type?: unknown; format?: unknown };

function kindOf(property: Property): FieldKind {
  if (property.type === "number" || property.type === "integer") {
    return "number";
  }
  return property.format === "date" ? "date" : "text";
}

/**
 * `unit_rate_pence:gt:30` as a filter on that field. The field must be in the type's schema
 * (so no arbitrary JSON path ever reaches SQL), the operator must suit the field's type and
 * the value must parse as that type.
 */
export function parseFieldFilter(raw: string, documentType: string): FieldFilter {
  const [field = "", operator = "", ...rest] = raw.split(":");
  const value = rest.join(":");
  const definition = getDocumentType(documentType);
  const properties = (definition ? (toJsonSchema(definition).properties ?? {}) : {}) as Record<
    string,
    Property
  >;
  const property = properties[field];

  if (!property) {
    const known = Object.keys(properties).join(", ");
    throw new RecordQueryError(
      `Unknown field "${field}" for ${documentType}; use one of: ${known}`,
    );
  }

  const kind = kindOf(property);
  if (!(OPERATORS[kind] as readonly string[]).includes(operator)) {
    throw new RecordQueryError(
      `"${operator}" does not apply to ${field} (${kind}); use one of: ${OPERATORS[kind].join(", ")}`,
    );
  }
  if (value === "") {
    throw new RecordQueryError(
      `Give a value to compare ${field} with, as in ${field}:${operator}:value`,
    );
  }
  if (kind === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new RecordQueryError(`${field} is a number, but "${value}" is not`);
    }
    return { field, operator: operator as FieldOperator, value: number, kind };
  }
  if (kind === "date" && !isIsoDate(value)) {
    throw new RecordQueryError(`${field} is a date: write it as YYYY-MM-DD, not "${value}"`);
  }
  return { field, operator: operator as FieldOperator, value, kind };
}

function day(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)?.trim();
  if (!value) {
    return undefined;
  }
  if (!isIsoDate(value)) {
    throw new RecordQueryError(`${name} must be a date as YYYY-MM-DD, not "${value}"`);
  }
  return value;
}

function positive(params: URLSearchParams, name: string, fallback: number, max = Infinity): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    const range = max === Infinity ? "1 or more" : `1 to ${String(max)}`;
    throw new RecordQueryError(`${name} must be a whole number from ${range}, not "${raw}"`);
  }
  return value;
}

/** The query string of GET /api/records, checked: anything wrong throws RecordQueryError */
export function parseRecordQuery(params: URLSearchParams): RecordQuery {
  const documentType = params.get("type")?.trim() || undefined;
  if (documentType && !getDocumentType(documentType)) {
    throw new RecordQueryError(`Unknown document type "${documentType}"`);
  }

  const raw = params.getAll("filter").filter((value) => value.trim() !== "");
  if (raw.length > 0 && !documentType) {
    throw new RecordQueryError("Field filters need a document type, as in type=uk-energy-bill");
  }

  const approvedFrom = day(params, "approved_from");
  const approvedTo = day(params, "approved_to");
  if (approvedFrom && approvedTo && approvedFrom > approvedTo) {
    throw new RecordQueryError("approved_from is after approved_to");
  }

  const search = params.get("q")?.trim() || undefined;

  return {
    ...(documentType ? { documentType } : {}),
    ...(search ? { search } : {}),
    ...(approvedFrom ? { approvedFrom } : {}),
    ...(approvedTo ? { approvedTo } : {}),
    fields: raw.map((value) => parseFieldFilter(value, documentType ?? "")),
    page: positive(params, "page", 1),
    pageSize: positive(params, "page_size", DEFAULT_RECORD_PAGE_SIZE, MAX_RECORD_PAGE_SIZE),
  };
}
