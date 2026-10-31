import { listDocumentTypeOptions, listRecords } from "@echdyn/core";
import Link from "next/link";
import type { SearchParams } from "@/lib/documents/params";
import { formatRelative } from "@/lib/documents/format";
import { exportHref, parseRecordListParams, recordListHref } from "@/lib/records/params";
import { summaryCells } from "@/lib/records/summary";
import { getServices } from "@/lib/services";
import { RecordFilters } from "./record-filters";

const quiet =
  "rounded-md px-2.5 py-1 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none";

export async function RecordList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { params, query, problem } = parseRecordListParams(await searchParams);
  const { db } = getServices();
  const [page, types] = await Promise.all([listRecords(db, query), listDocumentTypeOptions(db)]);
  const now = new Date();
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + page.items.length - 1;
  const exportTypes = params.type ? types.filter((t) => t.slug === params.type) : types;
  const filtered = Boolean(params.q ?? params.type ?? params.approved_from ?? params.approved_to);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          Every approved record, searchable, with its source PDF and how it was reached.
        </p>
        <div className="flex flex-col gap-1 text-sm text-muted sm:items-end">
          {exportTypes.map((type) => (
            <p key={type.slug} className="flex flex-wrap items-center gap-1">
              <span>
                Export {filtered ? "these" : "all"}
                {exportTypes.length > 1 ? ` ${type.name.toLowerCase()}s` : ""}:
              </span>
              <a href={exportHref(params, type.slug, "csv")} download className={quiet}>
                CSV
              </a>
              <a href={exportHref(params, type.slug, "xlsx")} download className={quiet}>
                Excel
              </a>
            </p>
          ))}
        </div>
      </div>

      <RecordFilters params={params} types={types} />

      {problem && (
        <p
          role="status"
          className="rounded-lg bg-highlight-soft px-4 py-3 text-sm text-highlight-ink"
        >
          {problem}. Showing records without that filter.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {page.items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium text-ink">
              {filtered ? "No records match these filters." : "No approved records yet"}
            </p>
            <p className="mt-2 text-sm text-muted">
              {filtered ? (
                <Link
                  href="/records"
                  className="font-medium text-slate underline underline-offset-4 hover:text-ink"
                >
                  Clear filters
                </Link>
              ) : (
                "Records appear here once a document is approved, by a reviewer or automatically."
              )}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium md:px-5">
                  Record
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  Approved
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium md:px-5">
                  <span className="sr-only">Source</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {page.items.map((record) => {
                const cells = summaryCells(record);
                return (
                  <tr
                    key={record.id}
                    className="group relative align-top transition-colors hover:bg-stone"
                  >
                    <td className="max-w-0 px-4 py-4 md:w-3/5 md:px-5">
                      {/* The link's ::after covers the row; the PDF link sits above it */}
                      <Link
                        href={`/records/${record.id}`}
                        title={record.filename}
                        className="block truncate font-medium text-ink underline-offset-4 group-hover:underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-highlight focus-visible:after:ring-inset"
                      >
                        {cells[0]?.value || record.filename}
                      </Link>
                      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
                        {cells.slice(1).map((cell) => (
                          <div key={cell.key} className="flex gap-1">
                            <dt>{cell.label}</dt>
                            <dd className="text-ink">{cell.value || "Not found"}</dd>
                          </div>
                        ))}
                        <div className="flex gap-1 truncate">
                          <dt className="sr-only">File</dt>
                          <dd className="truncate">{record.filename}</dd>
                        </div>
                      </dl>
                    </td>
                    <td className="hidden px-4 py-4 whitespace-nowrap text-muted md:table-cell">
                      <time dateTime={record.approvedAt.toISOString()}>
                        {formatRelative(record.approvedAt, now)}
                      </time>
                      <span className="block text-xs">
                        {record.approvedBy === "auto" ? "automatically" : `by ${record.approvedBy}`}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right md:px-5">
                      <a
                        href={`/documents/${record.documentId}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="relative z-10 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-muted hover:bg-stone focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
                      >
                        PDF
                        <span className="sr-only"> of {record.filename}</span>
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {page.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <p className="tabular-nums">
            Showing {first} to {last} of {page.total}
          </p>
          <div className="flex gap-2">
            {page.page > 1 && (
              <Link
                href={recordListHref(params, { page: page.page - 1 })}
                className="rounded-md border border-line bg-surface px-3 py-1.5 font-medium text-ink transition-colors hover:border-muted hover:bg-stone"
              >
                Previous
              </Link>
            )}
            {page.page < page.pageCount && (
              <Link
                href={recordListHref(params, { page: page.page + 1 })}
                className="rounded-md border border-line bg-surface px-3 py-1.5 font-medium text-ink transition-colors hover:border-muted hover:bg-stone"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RecordListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <div className="h-10 w-full rounded-md bg-surface" />
      <div className="h-80 rounded-lg border border-line bg-surface" />
    </div>
  );
}
