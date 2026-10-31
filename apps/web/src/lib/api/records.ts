import type { RecordSummary } from "@echdyn/core";

/** A record as the API returns it: snake_case, like every other endpoint */
export function recordJson(record: RecordSummary) {
  return {
    id: record.id,
    document_id: record.documentId,
    filename: record.filename,
    document_type: record.documentType,
    data: record.data,
    approved_by: record.approvedBy,
    approved_at: record.approvedAt,
  };
}
