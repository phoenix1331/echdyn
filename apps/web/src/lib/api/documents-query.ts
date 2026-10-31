import { DOCUMENT_STATUSES, type DocumentFilters, type DocumentStatus } from "@echdyn/core";

export const MAX_DOCUMENT_PAGE_SIZE = 100;

/** The query string of GET /api/documents: the UI's filters, but strict, so mistakes are reported */
export function parseDocumentQuery(params: URLSearchParams): DocumentFilters | string {
  const status = params.get("status")?.trim();
  if (status && !(DOCUMENT_STATUSES as readonly string[]).includes(status)) {
    return `status must be one of: ${DOCUMENT_STATUSES.join(", ")}`;
  }

  const numbers: Record<string, number> = {};
  for (const [name, max] of [
    ["page", Infinity],
    ["page_size", MAX_DOCUMENT_PAGE_SIZE],
  ] as const) {
    const raw = params.get(name)?.trim();
    if (!raw) {
      continue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      return `${name} must be a whole number from 1${max === Infinity ? " up" : ` to ${String(max)}`}`;
    }
    numbers[name] = value;
  }

  const type = params.get("type")?.trim();
  const q = params.get("q")?.trim();
  return {
    ...(status ? { status: status as DocumentStatus } : {}),
    ...(type ? { documentType: type } : {}),
    ...(q ? { search: q } : {}),
    ...(numbers.page ? { page: numbers.page } : {}),
    ...(numbers.page_size ? { pageSize: numbers.page_size } : {}),
  };
}
