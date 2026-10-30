"use client";

import Form from "next/form";

interface FilterBarProps {
  status?: string;
  type?: string;
  q?: string;
  types: { slug: string; name: string }[];
}

const control =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-quarry focus:ring-2 focus:ring-highlight dark:focus:border-ink";

/** A GET form, so filters live in the URL and survive refreshes, links and the back button */
export function FilterBar({ status, type, q, types }: FilterBarProps) {
  return (
    <Form action="/" className="flex flex-col gap-2 sm:flex-row" role="search">
      {status && <input type="hidden" name="status" value={status} />}
      <label className="sr-only" htmlFor="q">
        Search by file name
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search by file name"
        className={`${control} sm:w-72`}
      />
      {types.length > 1 && (
        <>
          <label className="sr-only" htmlFor="type">
            Document type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={control}
          >
            <option value="">All document types</option>
            {types.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      )}
      <button
        type="submit"
        className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-muted focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
      >
        Search
      </button>
    </Form>
  );
}
