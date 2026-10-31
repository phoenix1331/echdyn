import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { webhookDeliveries, webhookEndpoints } from "../db/schema";
import { SIGNATURE_HEADER, signWebhook } from "./signature";

export const DELIVERY_TIMEOUT_MS = 10_000;

/** The receiver did not take it: worth retrying later */
export class WebhookDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookDeliveryError";
  }
}

export type DeliveryOutcome = "delivered" | "skipped";

export interface DeliverOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Timed out";
  }
  const cause =
    error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return error instanceof Error ? `${error.message}${cause}` : String(error);
}

/**
 * One attempt at one delivery: POST the stored body, signed now, and record what happened.
 * A 2xx marks it delivered; anything else throws WebhookDeliveryError so the queue retries.
 * Deliveries to a deactivated endpoint, or already delivered, are skipped.
 */
export async function deliverWebhook(
  db: Database,
  deliveryId: string,
  { fetch: send = fetch, now = Date.now, timeoutMs = DELIVERY_TIMEOUT_MS }: DeliverOptions = {},
): Promise<DeliveryOutcome> {
  const [delivery] = await db
    .select({
      status: webhookDeliveries.status,
      event: webhookDeliveries.event,
      payload: webhookDeliveries.payload,
      url: webhookEndpoints.url,
      secret: webhookEndpoints.secret,
      active: webhookEndpoints.active,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
    .where(eq(webhookDeliveries.id, deliveryId));

  if (!delivery || delivery.status === "delivered") {
    return "skipped";
  }
  if (!delivery.active) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", lastError: "Endpoint deactivated" })
      .where(eq(webhookDeliveries.id, deliveryId));
    return "skipped";
  }

  const body = JSON.stringify(delivery.payload);
  const attemptedAt = new Date(now());
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const response = await send(delivery.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "echdyn-webhooks",
        "echdyn-event": delivery.event,
        "echdyn-delivery": deliveryId,
        [SIGNATURE_HEADER.toLowerCase()]: signWebhook(delivery.secret, body, now()),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    statusCode = response.status;
    // The body is not needed, but reading it frees the connection
    await response.body?.cancel();
    if (!response.ok) {
      error = `Responded ${String(response.status)}`;
    }
  } catch (cause) {
    error = describe(cause);
  }

  await db
    .update(webhookDeliveries)
    .set({
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      lastStatusCode: statusCode,
      lastError: error,
      lastAttemptAt: attemptedAt,
      ...(error === null ? { status: "delivered" as const, deliveredAt: attemptedAt } : {}),
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  if (error !== null) {
    throw new WebhookDeliveryError(error);
  }
  return "delivered";
}

/** After the last retry: the delivery stays in the log as failed */
export async function markDeliveryFailed(db: Database, deliveryId: string): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ status: "failed" })
    .where(eq(webhookDeliveries.id, deliveryId));
}
