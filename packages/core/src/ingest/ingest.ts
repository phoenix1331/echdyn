import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { firstRow } from "../db/rows";
import { documents, documentTypes, type DocumentStatus } from "../db/schema";
import { enqueueDocument, type DocumentQueue } from "../queue/queue";
import { documentStorageKey, type Storage } from "../storage/storage";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";
const UNIQUE_VIOLATION = "23505";

export type IngestErrorCode =
  "empty_file" | "too_large" | "not_pdf" | "unknown_document_type" | "unreadable_pdf";

export class IngestError extends Error {
  constructor(
    readonly code: IngestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export interface IngestInput {
  documentTypeSlug: string;
  filename: string;
  bytes: Uint8Array;
}

export interface IngestResult {
  id: string;
  status: DocumentStatus;
  duplicate: boolean;
}

export interface IngestDependencies {
  db: Database;
  storage: Storage;
  queue: DocumentQueue;
}

function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) === PDF_MAGIC;
}

function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as Error & { code?: string }).code === UNIQUE_VIOLATION) {
      return true;
    }
  }
  return false;
}

/** The checks every upload passes before anything is stored; inspecting runs them too */
export function checkUpload(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new IngestError("empty_file", "The uploaded file is empty");
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new IngestError(
      "too_large",
      `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or less`,
    );
  }

  if (!isPdf(bytes)) {
    throw new IngestError("not_pdf", "Only PDF files are supported");
  }
}

/** The latest version of a document type, or an IngestError naming the unknown slug */
export async function latestDocumentType(db: Database, slug: string) {
  const [documentType] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.slug, slug))
    .orderBy(desc(documentTypes.version))
    .limit(1);

  if (!documentType) {
    throw new IngestError("unknown_document_type", `Unknown document type "${slug}"`);
  }
  return documentType;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function ingestDocument(
  { db, storage, queue }: IngestDependencies,
  input: IngestInput,
): Promise<IngestResult> {
  checkUpload(input.bytes);
  const documentType = await latestDocumentType(db, input.documentTypeSlug);
  const sha256 = sha256Of(input.bytes);

  const findExisting = async (): Promise<IngestResult | undefined> => {
    const [existing] = await db
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(and(eq(documents.documentTypeId, documentType.id), eq(documents.sha256, sha256)));
    return existing && { ...existing, duplicate: true };
  };

  const existing = await findExisting();
  if (existing) {
    return existing;
  }

  // Content-addressed key: if two identical uploads race, both write the same bytes
  const storageKey = documentStorageKey(documentType.slug, sha256);
  await storage.put(storageKey, input.bytes, "application/pdf");

  let inserted: { id: string; status: DocumentStatus };
  try {
    const rows = await db
      .insert(documents)
      .values({
        documentTypeId: documentType.id,
        storageKey,
        originalFilename: input.filename,
        mimeType: "application/pdf",
        sizeBytes: input.bytes.byteLength,
        sha256,
      })
      .returning({ id: documents.id, status: documents.status });
    inserted = firstRow(rows, "document insert");
  } catch (error) {
    // Lost the race to a concurrent identical upload: the unique index is the real guard
    const winner = isUniqueViolation(error) ? await findExisting() : undefined;
    if (winner) {
      return winner;
    }
    throw error;
  }

  try {
    await enqueueDocument(queue, inserted.id);
  } catch (error) {
    await db
      .update(documents)
      .set({ status: "failed", error: "Could not queue the document for processing" })
      .where(eq(documents.id, inserted.id));
    throw error;
  }

  return { ...inserted, duplicate: false };
}
