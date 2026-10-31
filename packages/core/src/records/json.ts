import type { RecordSummary } from "./queries";

/** A record as the API and webhooks send it: snake_case, the same shape everywhere */
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
