import { getDocumentType, toJsonSchema, type RecordSummary } from "@echdyn/core";
import { formatValue, humanise } from "@/lib/review/fields";

export interface SummaryCell {
  key: string;
  label: string;
  /** Formatted as on the review screen; empty when the record has no value */
  value: string;
}

/**
 * The fields a document type names as its summary (supplier, period, total for bills),
 * formatted for a list. A type without one falls back to its first three fields.
 */
export function summaryCells(record: RecordSummary): SummaryCell[] {
  const definition = getDocumentType(record.documentType.slug, record.documentType.version);
  if (!definition) {
    return [];
  }
  const properties = (toJsonSchema(definition).properties ?? {}) as Partial<
    Record<string, { format?: unknown }>
  >;
  const keys = definition.summary ?? Object.keys(definition.schema.shape).slice(0, 3);

  return keys.map((key) => {
    const display = definition.display?.[key];
    return {
      key,
      label: display?.label ?? humanise(key),
      value: formatValue(record.data[key], display, properties[key]?.format),
    };
  });
}
