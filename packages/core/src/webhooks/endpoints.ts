import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { firstRow } from "../db/rows";
import { webhookDeliveries, webhookEndpoints, type WebhookDeliveryStatus } from "../db/schema";

export class WebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  deliveries: Record<WebhookDeliveryStatus, number>;
}

export interface CreatedWebhookEndpoint extends Omit<WebhookEndpoint, "deliveries"> {
  /** Only ever returned here: store it to verify signatures */
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

/** http(s) only, so an endpoint cannot point the worker at file: or other schemes */
export function checkWebhookUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new WebhookError('Give the endpoint as "url"');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebhookError(`"${raw}" is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WebhookError("Webhook URLs must use http or https");
  }
  return url.toString();
}

export async function createWebhookEndpoint(
  db: Database,
  input: { url: unknown; description?: unknown },
): Promise<CreatedWebhookEndpoint> {
  const url = checkWebhookUrl(input.url);
  const description =
    typeof input.description === "string" && input.description.trim() !== ""
      ? input.description.trim()
      : null;
  const secret = `whsec_${randomBytes(32).toString("hex")}`;

  const rows = await db.insert(webhookEndpoints).values({ url, description, secret }).returning();
  const { id, active, createdAt } = firstRow(rows, "webhook endpoint insert");
  return { id, url, description, active, createdAt, secret };
}

/** Every endpoint, newest first, with how its deliveries stand; secrets are never listed */
export async function listWebhookEndpoints(db: Database): Promise<WebhookEndpoint[]> {
  const [endpoints, counts] = await Promise.all([
    db
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        description: webhookEndpoints.description,
        active: webhookEndpoints.active,
        createdAt: webhookEndpoints.createdAt,
      })
      .from(webhookEndpoints)
      .orderBy(desc(webhookEndpoints.createdAt)),
    db
      .select({
        endpointId: webhookDeliveries.endpointId,
        status: webhookDeliveries.status,
        count: sql<number>`count(*)::int`,
      })
      .from(webhookDeliveries)
      .groupBy(webhookDeliveries.endpointId, webhookDeliveries.status),
  ]);

  return endpoints.map((endpoint) => {
    const deliveries = { pending: 0, delivered: 0, failed: 0 };
    for (const row of counts.filter((c) => c.endpointId === endpoint.id)) {
      deliveries[row.status] = row.count;
    }
    return { ...endpoint, deliveries };
  });
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Stops new deliveries; returns false for an unknown endpoint. The log is kept */
export async function deactivateWebhookEndpoint(db: Database, id: string): Promise<boolean> {
  if (!UUID.test(id)) {
    return false;
  }
  const rows = await db
    .update(webhookEndpoints)
    .set({ active: false })
    .where(eq(webhookEndpoints.id, id))
    .returning({ id: webhookEndpoints.id });
  return rows.length > 0;
}

/** The latest deliveries to one endpoint, newest first; null for an unknown endpoint */
export async function listWebhookDeliveries(
  db: Database,
  endpointId: string,
  limit = 50,
): Promise<WebhookDelivery[] | null> {
  if (!UUID.test(endpointId)) {
    return null;
  }
  const [endpoint] = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, endpointId));
  if (!endpoint) {
    return null;
  }

  return db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      lastStatusCode: webhookDeliveries.lastStatusCode,
      lastError: webhookDeliveries.lastError,
      lastAttemptAt: webhookDeliveries.lastAttemptAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
}
