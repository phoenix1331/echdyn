"use client";

import { startTransition, useActionState, useState } from "react";
import { approveReview } from "@/app/documents/[id]/actions";
import { CORRECTION_PREFIX, type ReviewState } from "@/lib/review/approval";
import type { ReviewField } from "@/lib/review/fields";
import { FieldIssues, flaggedRow } from "./field-list";

/** pending: flagged and not yet looked at; edited: a saved value replaces the model's */
type Decision = "pending" | "accepted" | "editing" | "edited";

const quiet =
  "rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none";
const input =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-right text-ink outline-none transition-colors focus:border-highlight focus:ring-2 focus:ring-highlight";
// Revealed on row hover or keyboard focus where there is a mouse; always shown on touch screens
const onHover =
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100";

/** A saved edit as the reviewer typed it, with the field's unit */
function withUnit(value: string, unit: string | undefined): string {
  if (!unit) {
    return value;
  }
  if (unit === "£") {
    return `£${value}`;
  }
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}

function FieldRow({
  field,
  runCount,
  decision,
  draft,
  saved,
  errors,
  onDecide,
  onDraft,
  onSave,
  onUndo,
}: {
  field: ReviewField;
  runCount: number;
  decision: Decision;
  draft: string;
  saved: string | undefined;
  errors: string[];
  onDecide: (decision: Decision) => void;
  onDraft: (value: string) => void;
  onSave: () => void;
  onUndo: () => void;
}) {
  const flagged = field.issues.length > 0;
  const editing = decision === "editing";
  const edited = decision === "edited" && saved !== undefined;
  const settled = flagged && decision !== "pending" && !editing;
  const shown = edited ? withUnit(saved, field.input.unit) : field.value;
  const cancel = () => {
    onDraft(saved ?? field.input.value);
    onDecide(saved !== undefined ? "edited" : flagged ? "pending" : "accepted");
  };
  const edit = (
    <button
      type="button"
      onClick={() => {
        onDecide("editing");
      }}
      className={`${quiet} text-muted hover:bg-stone hover:text-ink ${flagged || edited ? "" : onHover}`}
    >
      Edit
      <span className="sr-only"> {field.label}</span>
    </button>
  );

  return (
    <div
      id={`field-${field.key}`}
      className={`group px-4 py-3 ${flagged && !settled ? flaggedRow : ""}`}
    >
      <div className="flex items-center justify-between gap-4">
        <dt className="text-sm text-muted" title={field.description}>
          {field.label}
        </dt>
        {!editing && (
          <dd className="flex items-center gap-2">
            {!flagged && !edited && edit}
            <span className={`text-right font-medium ${shown ? "text-ink" : "text-muted"}`}>
              {shown || "Not found"}
            </span>
          </dd>
        )}
      </div>

      {flagged && !settled && (
        <dd>
          <FieldIssues field={field} runCount={runCount} />
        </dd>
      )}

      {edited && (
        <dd className="mt-1 text-right text-xs text-muted">
          Edited, was {field.value || "not found"}
          {/* Sent with Approve; nothing is written until then */}
          <input type="hidden" name={`${CORRECTION_PREFIX}${field.key}`} value={saved} />
        </dd>
      )}

      {editing && (
        <dd className="mt-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            <span className="sr-only">New value for {field.label}</span>
            {field.input.unit === "£" && <span aria-hidden>£</span>}
            <input
              value={draft}
              onChange={(event) => {
                onDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                // Enter saves this field rather than submitting the whole review
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSave();
                }
                if (event.key === "Escape") {
                  cancel();
                }
              }}
              type={field.input.type === "date" ? "date" : "text"}
              inputMode={field.input.type === "number" ? "decimal" : undefined}
              aria-invalid={errors.length > 0}
              autoFocus
              className={input}
            />
            {field.input.unit && field.input.unit !== "£" && (
              <span className="whitespace-nowrap">{field.input.unit}</span>
            )}
          </label>
        </dd>
      )}

      {errors.length > 0 && (
        <dd className="mt-1.5 space-y-0.5 text-sm text-brick">
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </dd>
      )}

      {(flagged || editing || edited) && (
        <dd className="mt-2 flex justify-end gap-1">
          {editing && (
            <>
              <button
                type="button"
                onClick={cancel}
                className={`${quiet} text-muted hover:bg-stone hover:text-ink`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                className={`${quiet} bg-highlight text-on-highlight hover:brightness-110`}
              >
                Save
              </button>
            </>
          )}
          {edited && (
            <button
              type="button"
              onClick={onUndo}
              className={`${quiet} text-muted hover:bg-stone hover:text-ink`}
            >
              Undo
            </button>
          )}
          {flagged && !editing && !edited && (
            <button
              type="button"
              aria-pressed={settled}
              onClick={() => {
                onDecide(settled ? "pending" : "accepted");
              }}
              className={`${quiet} ${
                settled
                  ? "bg-moss-soft text-moss hover:brightness-95"
                  : "text-highlight-ink hover:bg-highlight-soft"
              }`}
            >
              {settled ? "Checked" : "Looks right"}
            </button>
          )}
          {!editing && (flagged || edited) && edit}
        </dd>
      )}
    </div>
  );
}

export function ReviewForm({
  documentId,
  fields,
  runCount,
  canLabel,
}: {
  documentId: string;
  fields: ReviewField[];
  runCount: number;
  canLabel: boolean;
}) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(
    approveReview.bind(null, documentId),
    {},
  );
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.key, field.issues.length > 0 ? "pending" : "accepted"]),
    ),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.input.value])),
  );
  // Values the reviewer saved; a field is only corrected once its edit is saved
  const [saved, setSaved] = useState<Record<string, string | undefined>>({});
  const [override, setOverride] = useState(false);
  const [label, setLabel] = useState(false);
  const flagged = fields.filter((field) => field.issues.length > 0);
  const resolved = flagged.filter(
    (field) => decisions[field.key] === "accepted" || decisions[field.key] === "edited",
  ).length;
  const editingAny = Object.values(decisions).includes("editing");
  const ready = resolved === flagged.length && !editingAny;
  const save = (field: ReviewField) => {
    const value = (drafts[field.key] ?? "").trim();
    const unchanged = value === field.input.value;
    setSaved((current) => ({ ...current, [field.key]: unchanged ? undefined : value }));
    setDecisions((current) => ({
      ...current,
      // Saving the model's own value back counts as checking it
      [field.key]: unchanged ? "accepted" : "edited",
    }));
  };
  const undo = (field: ReviewField) => {
    setSaved((current) => ({ ...current, [field.key]: undefined }));
    setDrafts((current) => ({ ...current, [field.key]: field.input.value }));
    setDecisions((current) => ({
      ...current,
      [field.key]: field.issues.length > 0 ? "pending" : "accepted",
    }));
  };

  return (
    // Submitted by hand: a form action resets the form afterwards, which unticks controlled
    // checkboxes (React 19), and every value here already lives in state
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => {
          action(data);
        });
      }}
      className="flex flex-col gap-4"
    >
      <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            runCount={runCount}
            decision={decisions[field.key] ?? "accepted"}
            draft={drafts[field.key] ?? ""}
            saved={saved[field.key]}
            errors={state.fieldErrors?.[field.key] ?? []}
            onDecide={(decision) => {
              setDecisions((current) => ({ ...current, [field.key]: decision }));
            }}
            onDraft={(value) => {
              setDrafts((current) => ({ ...current, [field.key]: value }));
            }}
            onSave={() => {
              save(field);
            }}
            onUndo={() => {
              undo(field);
            }}
          />
        ))}
      </dl>

      {state.general && state.general.length > 0 && (
        <div role="alert" className="rounded-lg bg-brick-soft px-4 py-3 text-sm text-brick">
          {state.general.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        {flagged.length > 0 && (
          <p className="text-sm text-muted">
            {resolved} of {flagged.length} flagged {flagged.length === 1 ? "field" : "fields"}{" "}
            checked
          </p>
        )}
        {editingAny && (
          <p className="text-sm text-highlight-ink">Save or cancel your edit to approve.</p>
        )}
        {state.canOverride && (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="override"
              checked={override}
              onChange={(event) => {
                setOverride(event.target.checked);
              }}
              className="mt-0.5 accent-highlight"
            />
            The figures match the bill even though a check fails. Approve anyway.
          </label>
        )}
        {canLabel && (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="label"
              checked={label}
              onChange={(event) => {
                setLabel(event.target.checked);
              }}
              className="mt-0.5 accent-highlight"
            />
            Add to the labelled set, so evaluations measure models against this bill
          </label>
        )}
        <button
          type="submit"
          disabled={!ready || pending}
          className="rounded-md bg-highlight px-4 py-2.5 font-semibold text-on-highlight transition-[filter] hover:brightness-110 active:brightness-95 focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:opacity-50 disabled:hover:brightness-100"
        >
          {pending ? "Approving..." : "Approve"}
        </button>
      </div>
    </form>
  );
}
