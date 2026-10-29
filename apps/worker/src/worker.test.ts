import {
  createDatabase,
  createDocumentQueue,
  createRedisConnection,
  createStorage,
  documents,
  ingestDocument,
  loadConfig,
  PROCESS_DOCUMENT_JOB,
  seedDocumentTypes,
  type DocumentQueue,
  type PipelineStage,
} from "@echdyn/core";
import type { Job, Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDocumentWorker } from "./worker";

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;
const prefix = "echdyn-test-worker";

describe.skipIf(!testUrl || !testBucket)("createDocumentWorker", () => {
  const config = loadConfig();
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const storage = createStorage({ ...config, S3_BUCKET: testBucket ?? "" });
  const connection = createRedisConnection(config.REDIS_URL);
  const queue = createDocumentQueue(connection, prefix);
  const noopQueue = { add: () => Promise.resolve() } as unknown as DocumentQueue;
  let worker: Worker | undefined;

  beforeAll(async () => {
    await storage.ensureBucket();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await seedDocumentTypes(db);
    await queue.obliterate({ force: true });
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  afterAll(async () => {
    await queue.close();
    await connection.quit();
    await close();
  });

  async function upload(label: string): Promise<string> {
    const bytes = new TextEncoder().encode(`%PDF-1.7 ${label} ${Date.now()}`);
    const result = await ingestDocument(
      { db, storage, queue: noopQueue },
      { documentTypeSlug: "uk-energy-bill", filename: `${label}.pdf`, bytes },
    );
    return result.id;
  }

  function settle(w: Worker): Promise<{ event: "completed" | "failed"; job: Job }> {
    return new Promise((resolve) => {
      w.on("completed", (job) => {
        resolve({ event: "completed", job });
      });
      w.on("failed", (job, error) => {
        if (
          job &&
          (error.name === "UnrecoverableError" || job.attemptsMade >= (job.opts.attempts ?? 1))
        ) {
          resolve({ event: "failed", job });
        }
      });
    });
  }

  async function statusOf(id: string) {
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    return { status: row?.status, error: row?.error };
  }

  function start(stages: PipelineStage[]): Worker {
    worker = createDocumentWorker({ deps: { db, storage }, stages, connection, prefix });
    return worker;
  }

  const fastRetry = { attempts: 2, backoff: { type: "fixed", delay: 10 } } as const;

  it("retries a transient failure and then succeeds", async () => {
    const id = await upload("flaky");
    let calls = 0;
    const flaky: PipelineStage = {
      name: "extract",
      run: () => (++calls === 1 ? Promise.reject(new Error("timeout")) : Promise.resolve()),
    };
    const done = settle(start([flaky]));

    await queue.add(PROCESS_DOCUMENT_JOB, { documentId: id }, { ...fastRetry, jobId: id });
    const { event, job } = await done;

    expect(event).toBe("completed");
    expect(job.returnvalue).toBe("needs_review");
    expect(calls).toBe(2);
    expect(await statusOf(id)).toEqual({ status: "needs_review", error: null });
  });

  it("marks the document failed once retries are exhausted", async () => {
    const id = await upload("broken");
    const broken: PipelineStage = {
      name: "extract",
      run: () => Promise.reject(new Error("model returned invalid JSON")),
    };
    const done = settle(start([broken]));

    await queue.add(PROCESS_DOCUMENT_JOB, { documentId: id }, { ...fastRetry, jobId: id });
    const { event, job } = await done;

    expect(event).toBe("failed");
    expect(job.attemptsMade).toBe(2);
    expect(await statusOf(id)).toEqual({
      status: "failed",
      error: "model returned invalid JSON",
    });
  });

  it("does not retry a permanent failure", async () => {
    const id = await upload("orphan");
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    await storage.remove(row?.storageKey ?? "");
    const done = settle(start([]));

    await queue.add(PROCESS_DOCUMENT_JOB, { documentId: id }, { attempts: 3, jobId: id });
    const { event, job } = await done;

    expect(event).toBe("failed");
    expect(job.attemptsMade).toBe(1);
    expect((await statusOf(id)).status).toBe("failed");
  });
});
