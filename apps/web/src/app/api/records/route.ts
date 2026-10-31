import { listRecords, parseRecordQuery, RecordQueryError } from "@echdyn/core";
import { recordJson } from "@/lib/api/records";
import { problem } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/**
 * Approved records, newest first. Filters: `type`, `approved_from` and `approved_to`
 * (YYYY-MM-DD, inclusive), and repeatable `filter=field:operator:value` checked against the
 * type's schema, e.g. `filter=unit_rate_pence:gt:30`.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  let query;
  try {
    query = parseRecordQuery(new URL(request.url).searchParams);
  } catch (error) {
    if (error instanceof RecordQueryError) {
      return problem(422, "invalid_query", error.message);
    }
    throw error;
  }

  const page = await listRecords(getServices().db, query);
  return Response.json({
    records: page.items.map(recordJson),
    page: page.page,
    page_size: page.pageSize,
    total: page.total,
  });
}
