import { DOCUMENT_STATUSES, type DocumentStatus } from "@echdyn/core";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface ListParams {
  status?: DocumentStatus;
  type?: string;
  q?: string;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
}

function isStatus(value: string | undefined): value is DocumentStatus {
  return (DOCUMENT_STATUSES as readonly string[]).includes(value ?? "");
}

/** Anything unrecognised in the URL is dropped rather than shown as an error */
export function parseListParams(params: SearchParams): ListParams {
  const status = first(params.status);
  const type = first(params.type);
  const q = first(params.q);
  const page = Number(first(params.page));

  return {
    ...(isStatus(status) ? { status } : {}),
    ...(type ? { type } : {}),
    ...(q ? { q } : {}),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The list URL for these params with `changes` applied; changing a filter goes back to page 1 */
export function listHref(current: ListParams, changes: Partial<ListParams> = {}): string {
  const filtersChanged = Object.keys(changes).some((key) => key !== "page");
  const next = { ...current, ...(filtersChanged ? { page: 1 } : {}), ...changes };
  const query = new URLSearchParams();

  if (next.status) {
    query.set("status", next.status);
  }
  if (next.type) {
    query.set("type", next.type);
  }
  if (next.q) {
    query.set("q", next.q);
  }
  if (next.page > 1) {
    query.set("page", String(next.page));
  }

  const search = query.toString();
  return search ? `/?${search}` : "/";
}
