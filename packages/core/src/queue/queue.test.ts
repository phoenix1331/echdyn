import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createDocumentQueue, createRedisConnection, enqueueDocument } from "./queue";

describe.skipIf(!process.env.TEST_DATABASE_URL)("document queue", () => {
  const connection = createRedisConnection(loadConfig().REDIS_URL);
  const queue = createDocumentQueue(connection, "echdyn-test-queue");

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.close();
    await connection.quit();
  });

  it("configures the connection for BullMQ workers", () => {
    expect(connection.options.maxRetriesPerRequest).toBeNull();
  });

  it("enqueues one job per document, keyed by document id", async () => {
    await enqueueDocument(queue, "doc-1");
    await enqueueDocument(queue, "doc-1");

    const jobs = await queue.getJobs(["waiting"]);
    expect(jobs.map((job) => [job.id, job.name, job.data])).toEqual([
      ["doc-1", "process-document", { documentId: "doc-1" }],
    ]);
  });
});
