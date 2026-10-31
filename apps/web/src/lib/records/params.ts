import { parseRecordQuery, RecordQueryError, type RecordQuery } from "@echdyn/core";
import type { SearchParams } from "@/lib/documents/params";

/** The records page's filters, named as the API names them so a URL reads the same in both */
export interface RecordListParams {
  q?: string;
  type?: string;
  approved_from?: string;
  approved_to?: string;
  page: number;
}

export interface ParsedRecordList {
  params: RecordListParams;
  query: RecordQuery;
  /** Set when a filter could not be used, e.g. a malformed date typed into the URL */
  problem?: string;
}

const KEYS = ["q", "type", "approved_from", "approved_to"] as const;

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
}

function toSearch(params: RecordListParams, extra: Record<string, string> = {}): URLSearchParams {
  const search = new URLSearchParams();
  for (const key of KEYS) {
    const value = params[key];
    if (value) {
      search.set(key, value);
    }
  }
  if (params.page > 1) {
    search.set("page", String(params.page));
  }
  for (const [key, value] of Object.entries(extra)) {
    search.set(key, value);
  }
  return search;
}

/**
 * Reads the URL with the API's own checks. A bad value is reported and dropped rather than
 * failing the page, so a mistyped date still shows every record with a note saying why.
 */
export function parseRecordListParams(raw: SearchParams): ParsedRecordList {
  const page = Number(first(raw.page));
  const params: RecordListParams = {
    ...Object.fromEntries(KEYS.flatMap((key) => (first(raw[key]) ? [[key, first(raw[key])]] : []))),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };

  try {
    return { params, query: parseRecordQuery(toSearch(params)) };
  } catch (error) {
    if (!(error instanceof RecordQueryError)) {
      throw error;
    }
    const kept: RecordListParams = { ...(params.q ? { q: params.q } : {}), page: 1 };
    return { params: kept, query: parseRecordQuery(toSearch(kept)), problem: error.message };
  }
}

/** The records URL for these filters with `changes` applied; changing a filter goes back to page 1 */
export function recordListHref(
  current: RecordListParams,
  changes: Partial<RecordListParams> = {},
): string {
  const filtersChanged = Object.keys(changes).some((key) => key !== "page");
  const search = toSearch({ ...current, ...(filtersChanged ? { page: 1 } : {}), ...changes });
  const query = search.toString();
  return query ? `/records?${query}` : "/records";
}

/** The export API for these filters; a type is needed, as the columns come from it */
export function exportHref(params: RecordListParams, type: string, format: "csv" | "xlsx"): string {
  // Page 1 leaves paging out: an export holds every match
  return `/api/records/export?${toSearch({ ...params, type, page: 1 }, { format }).toString()}`;
}
