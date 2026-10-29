import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const DOCUMENT_QUEUE = "documents";
export const PROCESS_DOCUMENT_JOB = "process-document";

export interface ProcessDocumentJob {
  documentId: string;
}

export type DocumentQueue = Queue<ProcessDocumentJob>;

// BullMQ workers need maxRetriesPerRequest: null so blocking commands survive Redis blips.
// The caller owns the connection and must quit() it after closing queues and workers.
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createDocumentQueue(connection: Redis, prefix = "echdyn"): DocumentQueue {
  return new Queue<ProcessDocumentJob>(DOCUMENT_QUEUE, { connection, prefix });
}

export const DOCUMENT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
} as const;

export async function enqueueDocument(queue: DocumentQueue, documentId: string): Promise<void> {
  // jobId = documentId makes enqueueing idempotent: a second add is ignored
  await queue.add(
    PROCESS_DOCUMENT_JOB,
    { documentId },
    { ...DOCUMENT_JOB_OPTIONS, jobId: documentId },
  );
}
