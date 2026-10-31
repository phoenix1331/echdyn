import {
  exportFilename,
  exportTable,
  parseRecordQuery,
  RecordQueryError,
  toCsv,
  toXlsx,
} from "@echdyn/core";
import { problem } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

const TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/**
 * Approved records of one type as CSV or Excel: `type` (required), `format` (csv, the default,
 * or xlsx) and the same filters as GET /api/records. Downloads as a file.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const params = new URL(request.url).searchParams;
  const format = params.get("format")?.trim() || "csv";
  if (format !== "csv" && format !== "xlsx") {
    return problem(422, "invalid_query", `format must be csv or xlsx, not "${format}"`);
  }

  let table;
  try {
    table = await exportTable(getServices().db, parseRecordQuery(params));
  } catch (error) {
    if (error instanceof RecordQueryError) {
      return problem(422, "invalid_query", error.message);
    }
    throw error;
  }

  const body = format === "csv" ? toCsv(table) : new Uint8Array(await toXlsx(table));
  return new Response(body, {
    headers: {
      "content-type": TYPES[format],
      "content-disposition": `attachment; filename="${exportFilename(table, format)}"`,
      "cache-control": "no-store",
      // More matched than one export holds: narrow the filters
      ...(table.truncated ? { "x-echdyn-truncated": "true" } : {}),
    },
  });
}
