import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { documents, type DocumentStatus } from "../db/schema";

// Which states a document may move into from each state
export const allowedTransitions: Record<DocumentStatus, readonly DocumentStatus[]> = {
  queued: ["extracting", "failed"],
  extracting: ["queued", "needs_review", "approved", "failed"],
  needs_review: ["approved"],
  approved: [],
  failed: ["queued"],
};

export class StatusTransitionError extends Error {
  constructor(
    readonly documentId: string,
    readonly to: DocumentStatus,
  ) {
    super(`Document ${documentId} cannot move to "${to}" from its current status`);
    this.name = "StatusTransitionError";
  }
}

function sourcesFor(to: DocumentStatus): DocumentStatus[] {
  return (Object.keys(allowedTransitions) as DocumentStatus[]).filter((from) =>
    allowedTransitions[from].includes(to),
  );
}

/**
 * Atomically moves a document to `to` if its current status allows it.
 * The status check lives in the UPDATE's WHERE clause, so two workers racing on the
 * same document cannot both win, and no stale read can overwrite a newer status.
 */
export async function transitionStatus(
  db: Database,
  documentId: string,
  to: DocumentStatus,
  error: string | null = null,
): Promise<void> {
  const rows = await db
    .update(documents)
    .set({ status: to, error, stage: null })
    .where(and(eq(documents.id, documentId), inArray(documents.status, sourcesFor(to))))
    .returning({ id: documents.id });

  if (rows.length === 0) {
    throw new StatusTransitionError(documentId, to);
  }
}
