import { getDocumentReview, getDocumentType, estimateProcessingMs } from "@echdyn/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/documents/auto-refresh";
import { StatusBadge } from "@/components/documents/status-badge";
import { describeProgress, formatRelative } from "@/lib/documents/format";
import { buildReview, type ReviewView } from "@/lib/review/fields";
import { getServices } from "@/lib/services";
import { FieldList } from "./field-list";
import { ReviewForm } from "./review-form";

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

function Approved({ view }: { view: ReviewView }) {
  const corrected = view.fields.filter((field) => field.corrected).length;
  const by = view.approvedBy === "auto" ? "automatically" : `by ${view.approvedBy ?? "a reviewer"}`;

  return (
    <div className="rounded-lg bg-moss-soft px-4 py-3 text-sm text-moss">
      <p className="font-semibold">Approved {by}</p>
      <p className="mt-0.5">
        {view.approvedBy === "auto"
          ? "Every check passed and both runs read the same values."
          : corrected > 0
            ? `${plural(corrected, "field")} corrected before approval.`
            : "Every value was confirmed against the bill."}
      </p>
    </div>
  );
}

function LabelledNotice({ labelled }: { labelled: string | undefined }) {
  if (labelled === undefined) {
    return null;
  }
  if (labelled === "failed") {
    return (
      <p role="status" className="rounded-lg bg-brick-soft px-4 py-3 text-sm text-brick">
        Approved, but the document could not be added to the labelled set. The server log has the
        reason.
      </p>
    );
  }
  return (
    <p role="status" className="rounded-lg bg-slate-soft px-4 py-3 text-sm text-slate">
      Added to the labelled set as <code>{labelled}</code>.
    </p>
  );
}

function Summary({ view }: { view: ReviewView }) {
  const toCheck = view.fields.filter((f) => f.issues.length > 0).length;

  if (view.approvedBy !== undefined) {
    return <Approved view={view} />;
  }

  if (toCheck === 0 && view.general.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink">
        <p className="font-semibold">Nothing flagged</p>
        <p className="mt-0.5 text-muted">
          Every check passed. Confirm the fields against the bill.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-highlight-soft px-4 py-3 text-sm text-highlight-ink">
      <p className="text-base font-semibold">
        {toCheck > 0 ? `${plural(toCheck, "field")} to check` : "This document needs checking"}
      </p>
      {(view.checks.length > 0 || view.general.length > 0) && (
        <ul className="mt-2 space-y-2">
          {view.general.map((message) => (
            <li key={message}>{message}</li>
          ))}
          {view.checks.map((check) => (
            <li key={check.message}>
              {check.message}
              <span className="block text-xs opacity-80">Involves {check.fields.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function ReviewScreen({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const labelled = typeof query.labelled === "string" ? query.labelled : undefined;
  const { db, storage, config } = getServices();
  const review = await getDocumentReview(db, id);

  if (!review) {
    notFound();
  }

  const { document, runs } = review;
  const definition = getDocumentType(document.documentType.slug, document.documentType.version);
  const view = buildReview(
    review,
    definition?.display,
    definition ? Object.keys(definition.schema.shape) : [],
  );
  const active = document.status === "queued" || document.status === "extracting";
  const [pdfUrl, estimateMs] = await Promise.all([
    storage.signedUrl(document.storageKey, 60 * 60),
    active ? estimateProcessingMs(db) : null,
  ]);
  const primary = runs.at(0);
  const meta = [
    document.documentType.name,
    document.pageCount === null ? null : plural(document.pageCount, "page"),
    `uploaded ${formatRelative(document.createdAt)}`,
    primary ? `read by ${primary.model}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 py-6 md:px-8">
      <AutoRefresh active={active} />
      <Link
        href="/"
        className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
      >
        Back to documents
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight text-ink">
          {document.filename}
        </h1>
        <StatusBadge status={document.status} />
      </div>
      <p className="mt-1 text-sm text-muted">{meta.join(", ")}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_30rem]">
        <section
          aria-label="Original PDF"
          className="hidden h-[calc(100vh-11rem)] overflow-hidden rounded-lg border border-line bg-surface lg:sticky lg:top-6 lg:block"
        >
          <iframe title={document.filename} src={pdfUrl} className="h-full w-full" />
        </section>

        <div className="flex flex-col gap-4">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-line bg-surface px-4 py-2.5 text-center text-sm font-medium text-ink transition-colors hover:border-muted hover:bg-stone lg:hidden"
          >
            Open the PDF
          </a>

          {active && (
            <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              {(() => {
                const progress = describeProgress(document, estimateMs);
                return (
                  <>
                    <p className="font-semibold text-ink">
                      <span className={progress.active ? "highlighter -mx-1 rounded px-1" : ""}>
                        {progress.text}
                      </span>
                    </p>
                    {progress.detail && <p className="mt-0.5 text-muted">{progress.detail}</p>}
                    <p className="mt-2 text-muted">
                      The fields appear here as soon as they are read.
                    </p>
                  </>
                );
              })()}
            </div>
          )}

          {document.status === "failed" && (
            <div className="rounded-lg bg-brick-soft px-4 py-3 text-sm text-brick">
              <p className="font-semibold">Processing failed</p>
              <p className="mt-0.5">{document.error ?? "No reason was recorded."}</p>
            </div>
          )}

          {!active && runs.length === 0 && document.status !== "failed" && (
            <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              <p className="font-semibold text-ink">Nothing was read from this PDF</p>
              <p className="mt-0.5 text-muted">
                {document.hasTextLayer === false
                  ? "It is a scan with no text layer. Reading scans needs the vision model, which is not set up yet."
                  : "No extraction ran for this document."}
              </p>
            </div>
          )}

          {runs.length > 0 && (
            <>
              <LabelledNotice labelled={labelled} />
              <Summary view={view} />
              {document.status === "needs_review" ? (
                <ReviewForm
                  documentId={document.id}
                  fields={view.fields}
                  runCount={view.runCount}
                  canLabel={config.LABELLED_SET_DIR !== undefined}
                />
              ) : (
                <FieldList fields={view.fields} runCount={view.runCount} />
              )}
              <p className="text-xs text-muted">
                {runs
                  .map(
                    (run) =>
                      `Run ${String(run.runNumber)}: ${run.model}, prompt ${run.promptVersion}, ${(run.durationMs / 1000).toFixed(1)} s`,
                  )
                  .join(". ")}
                .
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReviewSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-[96rem] px-4 py-6 md:px-8">
      <div className="h-5 w-40 rounded bg-surface" />
      <div className="mt-4 h-8 w-80 rounded bg-surface" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_30rem]">
        <div className="hidden h-[calc(100vh-11rem)] rounded-lg border border-line bg-surface lg:block" />
        <div className="h-96 rounded-lg border border-line bg-surface" />
      </div>
    </div>
  );
}
