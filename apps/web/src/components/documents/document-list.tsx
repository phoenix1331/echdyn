import {
  ACTIVE_STATUSES,
  countDocumentsByStatus,
  estimateProcessingMs,
  listDocuments,
  listDocumentTypeOptions,
  type DocumentStatus,
} from "@echdyn/core";
import Link from "next/link";
import { describeProgress, formatRelative, STATUS_LABELS } from "@/lib/documents/format";
import {
  listHref,
  parseListParams,
  type ListParams,
  type SearchParams,
} from "@/lib/documents/params";
import { getServices } from "@/lib/services";
import { AutoRefresh } from "./auto-refresh";
import { FilterBar } from "./filter-bar";
import { StatusBadge } from "./status-badge";

// Ordered by what a reviewer acts on first
const TAB_ORDER: DocumentStatus[] = ["needs_review", "extracting", "queued", "approved", "failed"];

function StatusTabs({
  params,
  counts,
}: {
  params: ListParams;
  counts: Record<DocumentStatus, number>;
}) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tabs: { label: string; count: number; status?: DocumentStatus }[] = [
    { label: "All", count: total },
    ...TAB_ORDER.map((status) => ({ label: STATUS_LABELS[status], count: counts[status], status })),
  ];

  return (
    <nav aria-label="Filter by status" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((tab) => {
          const current = tab.status === params.status;
          return (
            <li key={tab.label}>
              <Link
                href={listHref(params, { status: tab.status })}
                aria-current={current ? "page" : undefined}
                className={`relative flex items-center gap-2 px-3 pt-2 pb-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none ${
                  current ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {tab.label}
                <span className="text-xs text-muted tabular-nums">{tab.count}</span>
                {current && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-1 rounded-full bg-highlight"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="font-medium text-ink">No documents match these filters.</p>
        <Link
          href="/"
          className="mt-2 inline-block text-sm font-medium text-slate underline underline-offset-4 hover:text-ink hover:decoration-2"
        >
          Clear filters
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <p className="text-lg font-semibold text-ink">No documents yet</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Upload a PDF to{" "}
        <code className="rounded bg-stone px-1.5 py-0.5 text-ink">POST /api/documents</code> with
        your API token. It appears here as soon as it is queued, and this page updates as it is
        processed.
      </p>
    </div>
  );
}

export async function DocumentList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = parseListParams(await searchParams);
  const { db } = getServices();
  const filters = {
    ...(params.type ? { documentType: params.type } : {}),
    ...(params.q ? { search: params.q } : {}),
  };

  const [page, counts, types, estimateMs] = await Promise.all([
    listDocuments(db, {
      ...filters,
      ...(params.status ? { status: params.status } : {}),
      page: params.page,
    }),
    countDocumentsByStatus(db, filters),
    listDocumentTypeOptions(db),
    estimateProcessingMs(db),
  ]);
  const active = ACTIVE_STATUSES.some((status) => counts[status] > 0);
  const now = new Date();
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + page.items.length - 1;

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh active={active} />
      <StatusTabs params={params} counts={counts} />
      <FilterBar
        types={types}
        {...(params.status ? { status: params.status } : {})}
        {...(params.type ? { type: params.type } : {})}
        {...(params.q ? { q: params.q } : {})}
      />

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {page.items.length === 0 ? (
          <EmptyState filtered={Boolean(params.status ?? params.type ?? params.q)} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium md:px-5">
                  Document
                </th>
                {/* Fixed on phones so the filename, not the status, gets the spare width */}
                <th scope="col" className="w-36 px-4 py-3 font-medium md:w-auto md:px-5">
                  Status
                </th>
                <th scope="col" className="hidden px-5 py-3 text-right font-medium md:table-cell">
                  Uploaded
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {page.items.map((doc) => {
                const progress = describeProgress(doc, estimateMs);
                return (
                  <tr
                    key={doc.id}
                    className="group relative align-top transition-colors hover:bg-stone"
                  >
                    <td className="max-w-0 px-4 py-4 md:w-1/2 md:px-5">
                      {/* The link's ::after covers the row, so anywhere on it opens the document */}
                      <Link
                        href={`/documents/${doc.id}`}
                        title={doc.filename}
                        className="block truncate font-medium text-ink underline-offset-4 group-hover:underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-highlight focus-visible:after:ring-inset"
                      >
                        {doc.filename}
                      </Link>
                      <p className="mt-0.5 truncate text-muted">
                        {doc.documentType.name}
                        {doc.pageCount !== null &&
                          `, ${String(doc.pageCount)} page${doc.pageCount === 1 ? "" : "s"}`}
                      </p>
                    </td>
                    <td className="px-4 py-4 md:px-5">
                      <StatusBadge status={doc.status} />
                      <p className="mt-1.5 text-ink">
                        <span
                          className={`rounded px-1 -mx-1 ${progress.active ? "highlighter" : ""} ${
                            doc.status === "failed" ? "text-brick" : ""
                          }`}
                        >
                          {progress.text}
                        </span>
                      </p>
                      {progress.detail && (
                        <p className="mt-0.5 text-xs text-muted tabular-nums">{progress.detail}</p>
                      )}
                    </td>
                    <td className="hidden px-5 py-4 text-right whitespace-nowrap text-muted tabular-nums md:table-cell">
                      <time
                        dateTime={doc.createdAt.toISOString()}
                        title={doc.createdAt.toLocaleString("en-GB")}
                      >
                        {formatRelative(doc.createdAt, now)}
                      </time>
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
                href={listHref(params, { page: page.page - 1 })}
                className="rounded-md border border-line bg-surface px-3 py-1.5 font-medium text-ink transition-colors hover:border-muted hover:bg-stone focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
              >
                Previous
              </Link>
            )}
            {page.page < page.pageCount && (
              <Link
                href={listHref(params, { page: page.page + 1 })}
                className="rounded-md border border-line bg-surface px-3 py-1.5 font-medium text-ink transition-colors hover:border-muted hover:bg-stone focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
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

export function DocumentListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <div className="h-11 border-b border-line" />
      <div className="h-10 w-full max-w-md rounded-md bg-surface" />
      <div className="h-80 rounded-lg border border-line bg-surface" />
    </div>
  );
}
