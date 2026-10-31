import { formatEstimate } from "@/lib/documents/format";

export type PageKind = "text" | "scan" | "blank";
export type ReadPath = "text" | "vision" | "mixed" | "none";

/** The JSON from POST /api/documents/inspect */
export interface InspectResponse {
  filename: string;
  size_bytes: number;
  page_count: number;
  page_kinds: PageKind[];
  path: ReadPath;
  estimated_ms: number | null;
  pages_not_read: number;
  duplicate: { id: string; filename: string; status: string; created_at: string } | null;
  queue: { ahead: number; estimated_wait_ms: number | null };
}

export interface Warning {
  message: string;
  /** Set when the warning points at an existing document */
  href?: string;
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** "1 typed page", "2 pages: 1 typed, 1 scanned" */
export function describePages(kinds: readonly PageKind[]): string {
  const labels: Record<PageKind, string> = { text: "typed", scan: "scanned", blank: "blank" };
  const parts = (Object.keys(labels) as PageKind[])
    .map((kind) => ({ label: labels[kind], count: kinds.filter((k) => k === kind).length }))
    .filter((part) => part.count > 0);

  if (parts.length === 1) {
    return parts
      .map((part) => `${String(part.count)} ${part.label} page${part.count === 1 ? "" : "s"}`)
      .join("");
  }
  return `${plural(kinds.length, "page")}: ${parts.map((part) => `${String(part.count)} ${part.label}`).join(", ")}`;
}

export const PATH_LABELS: Record<ReadPath, string> = {
  text: "Read from its text",
  vision: "Read from the scan",
  mixed: "Text and scan read together",
  none: "Nothing to read",
};

export function describeEstimate(inspection: InspectResponse): string {
  if (inspection.path === "none") {
    return "Goes straight to review";
  }
  return inspection.estimated_ms === null
    ? "No timing history yet"
    : formatEstimate(inspection.estimated_ms);
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function warningsFor(inspection: InspectResponse): Warning[] {
  const warnings: Warning[] = [];

  if (inspection.duplicate) {
    warnings.push({
      message: `Already uploaded on ${DATE.format(new Date(inspection.duplicate.created_at))} as ${inspection.duplicate.filename}. Uploading again opens that one.`,
      href: `/documents/${inspection.duplicate.id}`,
    });
  }
  if (inspection.path === "vision" || inspection.path === "mixed") {
    warnings.push({
      message:
        "Scanned pages are read by the vision model, which is slow without a GPU: expect minutes per page.",
    });
  }
  if (inspection.pages_not_read > 0) {
    warnings.push({
      message: `Only the first 10 scanned pages are read; ${plural(inspection.pages_not_read, "page")} will not be.`,
    });
  }
  if (inspection.path === "none") {
    warnings.push({
      message: "No text or scanned image was found, so a person will have to enter every field.",
    });
  }

  return warnings;
}

/** The queue line for the whole batch, or null when nothing is waiting */
export function describeQueue(queue: InspectResponse["queue"]): string | null {
  if (queue.ahead === 0) {
    return null;
  }
  const wait =
    queue.estimated_wait_ms === null ? "" : `, ${formatEstimate(queue.estimated_wait_ms)} to clear`;
  return `${plural(queue.ahead, "document")} ahead of these${wait}`;
}
