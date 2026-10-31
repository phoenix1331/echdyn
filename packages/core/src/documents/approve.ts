import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { firstRow } from "../db/rows";
import { corrections, documents, documentTypes, extractions, records } from "../db/schema";
import type { FieldError } from "../db/schema";
import { getDocumentType, toJsonSchema } from "../document-types/registry";
import { validateExtraction } from "../validation/validate";
import { dispatchDeliveries, recordApprovedDeliveries } from "../webhooks/events";
import type { WebhookQueue } from "../webhooks/queue";

export type ReviewErrorCode = "not_found" | "not_reviewable" | "nothing_extracted" | "unknown_type";

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export interface ApproveInput {
  /** Who approved it, stored on the record and on each correction */
  reviewer: string;
  /** Values the reviewer typed, keyed by field, in the schema's units; other fields keep run 1's value */
  corrections?: Readonly<Record<string, string>>;
  /** The reviewer checked the bill and approves although a business rule still fails */
  overrideChecks?: boolean;
}

export interface ApprovedDocument {
  approved: true;
  recordId: string;
  data: Record<string, unknown>;
  /** Fields whose value differs from run 1 */
  corrected: string[];
  document: { slug: string; filename: string; sha256: string; storageKey: string };
}

export interface RejectedApproval {
  approved: false;
  /** Schema errors always block; business rule errors block unless overridden */
  errors: FieldError[];
  /** Every field of the document type, so callers can tell field errors from general ones */
  fields: string[];
}

const NUMBER_NOISE = /[£,%\s]/g;

function isNumeric(type: unknown): boolean {
  return type === "number" || type === "integer";
}

/**
 * Turns typed text into the value the schema expects. Numbers accept the way people
 * type them (`£1,234.50`, `20%`); anything else is left as text for the schema to reject.
 */
export function coerceInput(raw: string, type: unknown): unknown {
  const text = raw.trim();
  if (!isNumeric(type)) {
    return text;
  }
  const cleaned = text.replace(NUMBER_NOISE, "");
  const value = Number(cleaned);
  return cleaned === "" || Number.isNaN(value) ? text : value;
}

/**
 * Approves a document in review: applies the reviewer's corrections over run 1, validates
 * the result, then in one transaction moves the document to approved, records each changed
 * field in `corrections` and writes the `records` row. The status change is guarded in the
 * UPDATE, so two reviewers approving at once cannot both write a record.
 */
export async function approveDocument(
  db: Database,
  documentId: string,
  input: ApproveInput,
  /** Approval webhooks are queued here after commit; without it they wait for the worker */
  webhooks?: WebhookQueue,
): Promise<ApprovedDocument | RejectedApproval> {
  const [document] = await db
    .select({
      status: documents.status,
      documentTypeId: documents.documentTypeId,
      filename: documents.originalFilename,
      sha256: documents.sha256,
      storageKey: documents.storageKey,
      slug: documentTypes.slug,
      version: documentTypes.version,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
    .where(eq(documents.id, documentId));

  if (!document) {
    throw new ReviewError("not_found", `Document ${documentId} does not exist`);
  }
  if (document.status !== "needs_review") {
    throw new ReviewError("not_reviewable", "This document is not waiting for review");
  }

  const definition = getDocumentType(document.slug, document.version);
  if (!definition) {
    throw new ReviewError(
      "unknown_type",
      `No definition for ${document.slug}@${String(document.version)}`,
    );
  }

  // A retried job can store a run twice; the latest attempt is the one the reviewer saw
  const [primary] = await db
    .select({ id: extractions.id, parsed: extractions.parsed })
    .from(extractions)
    .where(and(eq(extractions.documentId, documentId), eq(extractions.runNumber, 1)))
    .orderBy(desc(extractions.createdAt))
    .limit(1);

  if (!primary) {
    throw new ReviewError("nothing_extracted", "Nothing was read from this document yet");
  }

  const properties = (toJsonSchema(definition).properties ?? {}) as Record<
    string,
    { type?: unknown }
  >;
  const original = primary.parsed ?? {};
  const typed = Object.entries(input.corrections ?? {})
    .filter(([field]) => field in properties)
    .map(([field, raw]) => [field, coerceInput(raw, properties[field]?.type)] as const);
  const changed = typed.filter(([field, value]) => !isDeepStrictEqual(value, original[field]));
  const candidate = { ...original, ...Object.fromEntries(typed) };

  // Zod would say "expected number, received string"; a reviewer needs plainer words
  const notNumbers = new Set(
    typed
      .filter(([field, value]) => typeof value === "string" && isNumeric(properties[field]?.type))
      .map(([field]) => field),
  );
  const validation = validateExtraction(definition, candidate);
  const { data } = validation;
  const errors = validation.errors.map((error) =>
    notNumbers.has(error.field) ? { field: error.field, message: "Enter a number" } : error,
  );
  if (!data || (errors.length > 0 && !input.overrideChecks)) {
    return { approved: false, errors, fields: Object.keys(properties) };
  }

  const { recordId, deliveryIds } = await db.transaction(async (tx) => {
    const moved = await tx
      .update(documents)
      .set({ status: "approved", error: null, stage: null })
      .where(and(eq(documents.id, documentId), eq(documents.status, "needs_review")))
      .returning({ id: documents.id });

    if (moved.length === 0) {
      throw new ReviewError("not_reviewable", "This document was approved by someone else");
    }

    if (changed.length > 0) {
      await tx.insert(corrections).values(
        changed.map(([field, value]) => ({
          documentId,
          extractionId: primary.id,
          field,
          oldValue: original[field] ?? null,
          newValue: value,
          reviewer: input.reviewer,
        })),
      );
    }

    const inserted = await tx
      .insert(records)
      .values({
        documentId,
        extractionId: primary.id,
        documentTypeId: document.documentTypeId,
        data,
        approvedBy: input.reviewer,
      })
      .returning({ id: records.id });

    const id = firstRow(inserted, "record").id;
    return { recordId: id, deliveryIds: await recordApprovedDeliveries(tx, id) };
  });

  // The approval stands even if Redis is down: the deliveries stay pending and the worker
  // queues them again when it starts
  await dispatchDeliveries(webhooks, deliveryIds).catch(() => undefined);

  return {
    approved: true,
    recordId,
    data,
    corrected: changed.map(([field]) => field),
    document: {
      slug: document.slug,
      filename: document.filename,
      sha256: document.sha256,
      storageKey: document.storageKey,
    },
  };
}
