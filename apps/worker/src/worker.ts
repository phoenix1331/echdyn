import {
  DOCUMENT_QUEUE,
  PermanentPipelineError,
  processDocument,
  StatusTransitionError,
  transitionStatus,
  type Database,
  type PipelineDependencies,
  type PipelineLogger,
  type PipelineStage,
  type ProcessDocumentJob,
} from "@echdyn/core";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

export interface DocumentWorkerOptions {
  deps: PipelineDependencies;
  stages: readonly PipelineStage[];
  connection: Redis;
  prefix?: string;
  concurrency?: number;
  log?: PipelineLogger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordFailure(
  db: Database,
  documentId: string,
  final: boolean,
  message: string,
): Promise<void> {
  try {
    if (final) {
      await transitionStatus(db, documentId, "failed", message);
      return;
    }
    await transitionStatus(db, documentId, "queued", `Retrying after error: ${message}`);
  } catch (error) {
    // The document is gone or already in a state we must not overwrite (e.g. approved)
    if (!(error instanceof StatusTransitionError)) {
      throw error;
    }
  }
}

export function createProcessor(
  deps: PipelineDependencies,
  stages: readonly PipelineStage[],
  log: PipelineLogger,
) {
  return async (job: Job<ProcessDocumentJob>): Promise<string> => {
    const { documentId } = job.data;

    try {
      return await processDocument(deps, documentId, stages, log);
    } catch (error) {
      const message = errorMessage(error);
      const permanent =
        error instanceof PermanentPipelineError || error instanceof StatusTransitionError;
      // attemptsMade counts failures before this one
      const final = permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      log(`${documentId} failed (attempt ${job.attemptsMade + 1}): ${message}`);
      await recordFailure(deps.db, documentId, final, message);

      if (permanent) {
        throw new UnrecoverableError(message);
      }
      throw error;
    }
  };
}

export function createDocumentWorker(
  options: DocumentWorkerOptions,
): Worker<ProcessDocumentJob, string> {
  const log = options.log ?? (() => undefined);

  return new Worker<ProcessDocumentJob, string>(
    DOCUMENT_QUEUE,
    createProcessor(options.deps, options.stages, log),
    {
      connection: options.connection,
      prefix: options.prefix ?? "echdyn",
      concurrency: options.concurrency ?? 1,
    },
  );
}
