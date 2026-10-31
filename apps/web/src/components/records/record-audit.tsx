import { getDocumentReview, getDocumentType, getRecord } from "@echdyn/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FieldList } from "@/components/review/field-list";
import { auditTimeline, readings } from "@/lib/records/audit";
import { summaryCells } from "@/lib/records/summary";
import { buildReview } from "@/lib/review/fields";
import { getServices } from "@/lib/services";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const button =
  "rounded-md px-4 py-2 text-sm font-semibold transition-[filter,background-color] focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:outline-none";

export async function RecordAudit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = getServices();
  const record = await getRecord(db, id);
  const review = record ? await getDocumentReview(db, record.documentId) : null;
  if (!record || !review) {
    notFound();
  }

  const definition = getDocumentType(record.documentType.slug, record.documentType.version);
  const display = definition?.display ?? {};
  const view = buildReview(review, display, definition ? Object.keys(definition.schema.shape) : []);
  const labelOf = (key: string) => view.fields.find((field) => field.key === key)?.label ?? key;
  const events = auditTimeline(review, labelOf);
  const rows = readings(review, view.fields, display);
  const title = summaryCells(record)[0]?.value ?? "";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <Link
        href="/records"
        className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
      >
        Back to records
      </Link>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
            {title || record.filename}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {record.documentType.name}, {record.filename}.{" "}
            {record.approvedBy === "auto"
              ? "Approved automatically"
              : `Approved by ${record.approvedBy}`}{" "}
            on {DATE_TIME.format(record.approvedAt)} UTC.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={`/documents/${record.documentId}/pdf`}
            target="_blank"
            rel="noreferrer"
            className={`${button} bg-highlight text-on-highlight hover:brightness-110`}
          >
            Open the PDF
          </a>
          <Link
            href={`/documents/${record.documentId}`}
            className={`${button} border border-line bg-surface text-ink hover:border-muted hover:bg-stone`}
          >
            Review screen
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="values-heading" className="flex flex-col gap-3">
          <h2 id="values-heading" className="font-semibold text-ink">
            Approved values
          </h2>
          <FieldList fields={view.fields} runCount={view.runCount} />

          <h2 id="readings-heading" className="mt-4 font-semibold text-ink">
            What each run read
          </h2>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table aria-labelledby="readings-heading" className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Field
                  </th>
                  {review.runs.map((run) => (
                    <th
                      key={run.runNumber}
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Run {run.runNumber}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Approved
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.key} className={row.differs ? "bg-highlight-soft/50" : ""}>
                    <th scope="row" className="px-4 py-2 font-normal text-muted">
                      {row.label}
                    </th>
                    {row.runs.map((value, i) => (
                      <td key={i} className="px-4 py-2 text-right">
                        {value || <span className="text-muted">nothing</span>}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-medium text-ink">{row.approved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="trail-heading">
          <h2 id="trail-heading" className="font-semibold text-ink">
            Audit trail
          </h2>
          <ol className="mt-3 border-l-2 border-line">
            {events.map((event, i) => (
              <li key={i} className="relative pb-5 pl-5 last:pb-0">
                <span
                  aria-hidden
                  className={`absolute top-1.5 -left-[7px] size-3 rounded-full border-2 border-surface ${
                    event.attention ? "bg-highlight" : "bg-muted"
                  }`}
                />
                <p className="text-sm font-medium text-ink">{event.title}</p>
                {event.detail && <p className="text-sm text-muted">{event.detail}</p>}
                <time dateTime={event.at.toISOString()} className="text-xs text-muted">
                  {DATE_TIME.format(event.at)} UTC
                </time>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

export function RecordAuditSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <div className="h-5 w-32 rounded bg-surface" />
      <div className="mt-4 h-8 w-80 rounded bg-surface" />
      <div className="mt-6 h-96 rounded-lg border border-line bg-surface" />
    </div>
  );
}
