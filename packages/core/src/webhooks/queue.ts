import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const WEBHOOK_QUEUE = "webhooks";
export const DELIVER_WEBHOOK_JOB = "deliver-webhook";

export interface DeliverWebhookJob {
  deliveryId: string;
}

export type WebhookQueue = Queue<DeliverWebhookJob>;

/** Eight tries over about an hour: 30 s, 1 min, 2, 4, 8, 16, 32 min */
export const WEBHOOK_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
} as const;

export function createWebhookQueue(connection: Redis, prefix = "echdyn"): WebhookQueue {
  return new Queue<DeliverWebhookJob>(WEBHOOK_QUEUE, { connection, prefix });
}

export async function enqueueDeliveries(
  queue: WebhookQueue,
  deliveryIds: readonly string[],
): Promise<void> {
  // jobId = deliveryId: re-adding a delivery that already has a job does nothing
  await queue.addBulk(
    deliveryIds.map((deliveryId) => ({
      name: DELIVER_WEBHOOK_JOB,
      data: { deliveryId },
      opts: { ...WEBHOOK_JOB_OPTIONS, jobId: deliveryId },
    })),
  );
}
