import { listDocumentTypeOptions } from "@echdyn/core";
import { getServices } from "@/lib/services";

const link =
  "rounded-md px-2.5 py-1 text-sm font-medium text-ink transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none";

/** Downloads of every approved record of each type, from the export API */
export async function ExportLinks() {
  const types = await listDocumentTypeOptions(getServices().db);

  return (
    <div className="flex flex-col gap-1 text-sm text-muted sm:items-end">
      {types.map((type) => {
        const href = (format: string) =>
          `/api/records/export?type=${encodeURIComponent(type.slug)}&format=${format}`;
        return (
          <p key={type.slug} className="flex flex-wrap items-center gap-1">
            <span>
              Export approved {types.length > 1 ? type.name.toLowerCase() + "s" : "records"}:
            </span>
            <a href={href("csv")} download className={link}>
              CSV
            </a>
            <a href={href("xlsx")} download className={link}>
              Excel
            </a>
          </p>
        );
      })}
    </div>
  );
}
