import type { DocumentStatus, DocumentSummary } from "@echdyn/core";

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  queued: "Queued",
  extracting: "Processing",
  needs_review: "Needs review",
  approved: "Approved",
  failed: "Failed",
};

/** Rough, so it reads as an estimate: 37 s is "about 35 s", 130 s is "about 2 min" */
export function formatEstimate(ms: number): string {
  // Rounded first, so 59 s reads "about 1 min" rather than "about 60 s"
  const seconds = Math.max(5, Math.round(ms / 5000) * 5);
  if (seconds < 60) {
    return `about ${String(seconds)} s`;
  }
  return `about ${String(Math.round(seconds / 60))} min`;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function formatRelative(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${String(minutes)} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} h ago`;
  }
  if (hours < 48) {
    return "yesterday";
  }
  return DATE.format(date);
}

export interface Progress {
  /** What is happening, or what the reviewer needs to do */
  text: string;
  /** Supporting detail, such as a time estimate */
  detail?: string;
  /** True while the document is actively being worked on */
  active?: boolean;
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** One line telling the reviewer where a document is and, when it matters, how long it may take */
export function describeProgress(doc: DocumentSummary, estimateMs: number | null): Progress {
  if (doc.status === "queued") {
    const ahead = doc.queueAhead ?? 0;
    const text = ahead === 0 ? "Next in line" : `${plural(ahead, "document")} ahead`;
    return estimateMs === null
      ? { text }
      : { text, detail: `Done in ${formatEstimate((ahead + 1) * estimateMs)}` };
  }
  if (doc.status === "extracting") {
    const text = doc.stage ?? "Starting";
    return estimateMs === null
      ? { text, active: true }
      : { text, detail: `Usually takes ${formatEstimate(estimateMs)}`, active: true };
  }
  if (doc.status === "needs_review") {
    return {
      text:
        doc.flagCount === 0 ? "Check every field" : `${plural(doc.flagCount, "field")} to check`,
    };
  }
  if (doc.status === "failed") {
    return { text: doc.error ?? "Processing failed" };
  }
  return { text: "All fields checked" };
}
