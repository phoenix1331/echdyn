import Form from "next/form";
import type { RecordListParams } from "@/lib/records/params";

const control =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-quarry focus:ring-2 focus:ring-highlight dark:focus:border-ink";

/** A GET form, so a search lives in the URL and can be bookmarked or shared */
export function RecordFilters({
  params,
  types,
}: {
  params: RecordListParams;
  types: { slug: string; name: string }[];
}) {
  return (
    <Form action="/records" role="search" className="flex flex-col gap-2 lg:flex-row lg:items-end">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted lg:flex-1">
        Search
        <input
          name="q"
          type="search"
          defaultValue={params.q}
          placeholder="File name, supplier, account number, amount..."
          className={control}
        />
      </label>
      {types.length > 1 && (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Document type
          <select name="type" defaultValue={params.type ?? ""} className={control}>
            <option value="">All types</option>
            {types.map((type) => (
              <option key={type.slug} value={type.slug}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Approved from
        <input
          name="approved_from"
          type="date"
          defaultValue={params.approved_from}
          className={control}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Approved to
        <input
          name="approved_to"
          type="date"
          defaultValue={params.approved_to}
          className={control}
        />
      </label>
      <button
        type="submit"
        className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-muted hover:bg-stone focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
      >
        Search
      </button>
    </Form>
  );
}
