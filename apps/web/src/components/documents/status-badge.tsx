import type { DocumentStatus } from "@echdyn/core";
import { STATUS_LABELS } from "@/lib/documents/format";

const styles: Record<DocumentStatus, string> = {
  queued: "bg-slate-soft text-slate",
  extracting: "bg-slate-soft text-slate",
  needs_review: "bg-highlight text-[#3d3200]",
  approved: "bg-moss-soft text-moss",
  failed: "bg-brick-soft text-brick",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${styles[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
