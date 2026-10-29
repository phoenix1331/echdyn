import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createDatabase } from "../db/client";
import { documents } from "../db/schema";
import { seedDocumentTypes } from "../document-types/seed";
import { ingestDocument } from "../ingest/ingest";
import type { DocumentQueue } from "../queue/queue";
import { createStorage } from "../storage/storage";
import { PermanentPipelineError, processDocument, type PipelineStage } from "./pipeline";
import { transitionStatus } from "./status";

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;

describe.skipIf(!testUrl || !testBucket)("processDocument", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const storage = createStorage({ ...loadConfig(), S3_BUCKET: testBucket ?? "" });
  const deps = { db, storage };
  const noopQueue = { add: () => Promise.resolve() } as unknown as DocumentQueue;
  let documentId: string;

  async function statusOf(id = documentId) {
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    return row?.status;
  }

  beforeAll(async () => {
    await storage.ensureBucket();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await seedDocumentTypes(db);
    const bytes = new TextEncoder().encode(`%PDF-1.7 pipeline ${Date.now()}`);
    documentId = (
      await ingestDocument(
        { db, storage, queue: noopQueue },
        { documentTypeSlug: "uk-energy-bill", filename: "bill.pdf", bytes },
      )
    ).id;
  });

  afterAll(async () => {
    await close();
  });

  it("runs stages in order while extracting, then leaves the document for review", async () => {
    const seen: string[] = [];
    const stages: PipelineStage[] = ["pre-process", "extract"].map((name) => ({
      name,
      run: async (ctx) => {
        seen.push(`${name}:${(await statusOf(ctx.document.id)) ?? ""}`);
        expect(ctx.file.byteLength).toBeGreaterThan(0);
        expect(ctx.documentType.slug).toBe("uk-energy-bill");
      },
    }));
    const logs: string[] = [];

    const outcome = await processDocument(deps, documentId, stages, (m) => logs.push(m));

    expect(seen).toEqual(["pre-process:extracting", "extract:extracting"]);
    expect(outcome).toBe("needs_review");
    expect(await statusOf()).toBe("needs_review");
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(new RegExp(`^${documentId} pre-process \\d+ms$`));
  });

  it("lets a stage auto-approve a clean document", async () => {
    const approve: PipelineStage = {
      name: "score",
      run: (ctx) => {
        ctx.outcome = "approved";
        return Promise.resolve();
      },
    };

    await expect(processDocument(deps, documentId, [approve])).resolves.toBe("approved");
    expect(await statusOf()).toBe("approved");
  });

  it("resumes a document left extracting by a crashed attempt", async () => {
    await transitionStatus(db, documentId, "extracting");

    await expect(processDocument(deps, documentId, [])).resolves.toBe("needs_review");
  });

  it("propagates stage errors and leaves the status for the caller", async () => {
    const broken: PipelineStage = {
      name: "extract",
      run: () => Promise.reject(new Error("ollama unreachable")),
    };

    await expect(processDocument(deps, documentId, [broken])).rejects.toThrow("ollama unreachable");
    expect(await statusOf()).toBe("extracting");
  });

  it("fails permanently when the document does not exist", async () => {
    await expect(
      processDocument(deps, "00000000-0000-0000-0000-000000000000", []),
    ).rejects.toBeInstanceOf(PermanentPipelineError);
  });

  it("fails permanently when the file is missing from storage", async () => {
    const [row] = await db.select().from(documents).where(eq(documents.id, documentId));
    await storage.remove(row?.storageKey ?? "");

    await expect(processDocument(deps, documentId, [])).rejects.toThrow(/missing from storage/);
  });
});
