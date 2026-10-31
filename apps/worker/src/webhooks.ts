import {
  deliverWebhook,
  markDeliveryFailed,
  WEBHOOK_QUEUE,
  type Database,
  type DeliverOptions,
  type DeliverWebhookJob,
  type DeliveryOutcome,
  type PipelineLogger,
} from "@echdyn/core";
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

export interface WebhookWorkerOptions {
  db: Database;
  connection: Redis;
  prefix?: string;
  /** Deliveries wait on the network, not the model, so several run at once */
  concurrency?: number;
  log?: PipelineLogger;
  deliver?: DeliverOptions;
}

export function createWebhookProcessor(
  db: Database,
  log: PipelineLogger,
  deliver: DeliverOptions = {},
) {
  return async (job: Job<DeliverWebhookJob>): Promise<DeliveryOutcome> => {
    const { deliveryId } = job.data;
    try {
      return await deliverWebhook(db, deliveryId, deliver);
    } catch (error) {
      // attemptsMade counts failures before this one
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const message = error instanceof Error ? error.message : String(error);
      log(`webhook ${deliveryId} failed (attempt ${String(job.attemptsMade + 1)}): ${message}`);
      if (final) {
        await markDeliveryFailed(db, deliveryId);
      }
      throw error;
    }
  };
}

export function createWebhookWorker(
  options: WebhookWorkerOptions,
): Worker<DeliverWebhookJob, DeliveryOutcome> {
  return new Worker<DeliverWebhookJob, DeliveryOutcome>(
    WEBHOOK_QUEUE,
    createWebhookProcessor(options.db, options.log ?? (() => undefined), options.deliver),
    {
      connection: options.connection,
      prefix: options.prefix ?? "echdyn",
      concurrency: options.concurrency ?? 5,
    },
  );
}
