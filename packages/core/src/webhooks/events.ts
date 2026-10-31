import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database, Executor } from "../db/client";
import { webhookDeliveries, webhookEndpoints } from "../db/schema";
import { recordJson } from "../records/json";
import { getRecordSummary } from "../records/queries";
import type { WebhookQueue } from "./queue";
import { enqueueDeliveries } from "./queue";

export type WebhookEvent = "record.approved" | "ping";

/** The body every delivery sends; `id` is shared by every endpoint's copy of one event */
export function eventEnvelope(type: WebhookEvent, data: Record<string, unknown>, now = new Date()) {
  return { id: randomUUID(), type, created_at: now.toISOString(), data };
}

/**
 * Writes one pending delivery per active endpoint for a newly approved record. Called inside
 * the approval transaction (an outbox): the event exists exactly when the record does, and the
 * queue job is added after commit, so a crash in between leaves a pending row to requeue.
 */
export async function recordApprovedDeliveries(tx: Executor, recordId: string): Promise<string[]> {
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.active, true));
  if (endpoints.length === 0) {
    return [];
  }

  const record = await getRecordSummary(tx, recordId);
  if (!record) {
    return [];
  }
  const payload = eventEnvelope("record.approved", { record: recordJson(record) });
  const rows = await tx
    .insert(webhookDeliveries)
    .values(
      endpoints.map((endpoint) => ({ endpointId: endpoint.id, event: payload.type, payload })),
    )
    .returning({ id: webhookDeliveries.id });
  return rows.map((row) => row.id);
}

/** After the transaction commits: hand the deliveries to the queue, if there is one */
export async function dispatchDeliveries(
  queue: WebhookQueue | undefined,
  deliveryIds: readonly string[],
): Promise<void> {
  if (queue && deliveryIds.length > 0) {
    await enqueueDeliveries(queue, deliveryIds);
  }
}

/** A test event for one endpoint, so its owner can check their receiver and secret */
export async function pingWebhookEndpoint(
  db: Database,
  queue: WebhookQueue,
  endpointId: string,
): Promise<string | null> {
  const [endpoint] = await db
    .select({ id: webhookEndpoints.id, url: webhookEndpoints.url })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, endpointId));
  if (!endpoint) {
    return null;
  }

  const payload = eventEnvelope("ping", { endpoint: { id: endpoint.id, url: endpoint.url } });
  const [row] = await db
    .insert(webhookDeliveries)
    .values({ endpointId, event: payload.type, payload })
    .returning({ id: webhookDeliveries.id });
  const id = row?.id ?? "";
  await enqueueDeliveries(queue, [id]);
  return id;
}

/** On worker start: any delivery still pending gets its job back (adding is idempotent) */
export async function requeuePendingDeliveries(db: Database, queue: WebhookQueue): Promise<number> {
  const pending = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.status, "pending"));
  await enqueueDeliveries(
    queue,
    pending.map((row) => row.id),
  );
  return pending.length;
}
