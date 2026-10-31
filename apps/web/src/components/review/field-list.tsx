import type { ReviewField } from "@/lib/review/fields";

function runNote(runs: number[], runCount: number): string {
  if (runs.length === 0 || runs.length === runCount) {
    return "";
  }
  return ` (run ${runs.join(" and ")} only)`;
}

/** Why a field is flagged, and what the model copied from the page */
export function FieldIssues({ field, runCount }: { field: ReviewField; runCount: number }) {
  return (
    <div className="mt-2 space-y-1 text-sm text-highlight-ink">
      {field.issues.map((issue) => (
        <p key={`${issue.kind}${issue.message}`}>
          {issue.message}
          {runNote(issue.runs, runCount)}
        </p>
      ))}
      {field.printed && (
        <p className="text-muted">
          On the bill: <span className="font-medium text-ink">{field.printed}</span>
        </p>
      )}
    </div>
  );
}

export const flaggedRow = "border-l-4 border-l-highlight bg-highlight-soft/50 pl-3";

/** Read-only fields, for documents that are processing or already approved */
export function FieldList({ fields, runCount }: { fields: ReviewField[]; runCount: number }) {
  return (
    <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {fields.map((field) => {
        const flagged = field.issues.length > 0;
        return (
          <div
            key={field.key}
            id={`field-${field.key}`}
            className={`px-4 py-3 ${flagged ? flaggedRow : ""}`}
          >
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted" title={field.description}>
                {field.label}
              </dt>
              {/* No tabular-nums: in this typeface it also widens commas and full stops */}
              <dd className={`text-right font-medium ${field.value ? "text-ink" : "text-muted"}`}>
                {field.value || "Not found"}
              </dd>
            </div>
            {flagged && (
              <dd>
                <FieldIssues field={field} runCount={runCount} />
              </dd>
            )}
            {field.corrected && (
              <dd className="mt-1 text-right text-xs text-muted">
                Corrected by {field.corrected.by}, was {field.corrected.from}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
