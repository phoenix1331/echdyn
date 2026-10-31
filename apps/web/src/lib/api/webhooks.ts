import type { WebhookEndpoint } from "@echdyn/core";

export function endpointJson(
  endpoint: Omit<WebhookEndpoint, "deliveries"> & Partial<WebhookEndpoint>,
) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    active: endpoint.active,
    created_at: endpoint.createdAt,
    ...(endpoint.deliveries ? { deliveries: endpoint.deliveries } : {}),
  };
}
