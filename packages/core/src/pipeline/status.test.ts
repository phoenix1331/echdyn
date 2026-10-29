import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { documents, documentTypes } from "../db/schema";
import { allowedTransitions, StatusTransitionError, transitionStatus } from "./status";

const testUrl = process.env.TEST_DATABASE_URL;

describe("allowedTransitions", () => {
  it("treats approved as terminal and only lets failed documents be requeued", () => {
    expect(allowedTransitions.approved).toEqual([]);
    expect(allowedTransitions.failed).toEqual(["queued"]);
  });
});

describe.skipIf(!testUrl)("transitionStatus", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 4 });
  let documentId: string;

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    const [type] = await db
      .insert(documentTypes)
      .values({ slug: "t", name: "T", version: 1, schema: {} })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: type?.id ?? "",
        storageKey: "k",
        originalFilename: "f.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "e".repeat(64),
      })
      .returning();
    documentId = document?.id ?? "";
  });

  afterAll(async () => {
    await close();
  });

  async function statusOf() {
    const [row] = await db.select().from(documents).where(eq(documents.id, documentId));
    return { status: row?.status, error: row?.error };
  }

  it("moves through allowed states and records an error message", async () => {
    await transitionStatus(db, documentId, "extracting");
    await transitionStatus(db, documentId, "failed", "ollama timed out");

    expect(await statusOf()).toEqual({ status: "failed", error: "ollama timed out" });
  });

  it("clears the error on the next transition", async () => {
    await transitionStatus(db, documentId, "failed", "boom");
    await transitionStatus(db, documentId, "queued");

    expect(await statusOf()).toEqual({ status: "queued", error: null });
  });

  it("refuses a transition the current status does not allow", async () => {
    await expect(transitionStatus(db, documentId, "approved")).rejects.toBeInstanceOf(
      StatusTransitionError,
    );
    expect((await statusOf()).status).toBe("queued");
  });

  it("refuses unknown documents", async () => {
    await expect(
      transitionStatus(db, "00000000-0000-0000-0000-000000000000", "extracting"),
    ).rejects.toThrow(/cannot move to "extracting"/);
  });

  it("lets exactly one of two racing workers claim a document", async () => {
    await transitionStatus(db, documentId, "extracting");
    await transitionStatus(db, documentId, "needs_review");

    const results = await Promise.allSettled([
      transitionStatus(db, documentId, "approved"),
      transitionStatus(db, documentId, "approved"),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});
