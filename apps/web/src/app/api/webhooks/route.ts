import { createWebhookEndpoint, listWebhookEndpoints, WebhookError } from "@echdyn/core";
import { problem } from "@/lib/api/upload";
import { endpointJson } from "@/lib/api/webhooks";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/** Every endpoint with how its deliveries stand; secrets are never listed */
export async function GET(request: Request): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const endpoints = await listWebhookEndpoints(getServices().db);
  return Response.json({ webhooks: endpoints.map(endpointJson) });
}

/**
 * Adds an endpoint (JSON `{ "url": ..., "description": ... }`). The response carries the
 * signing secret, the only time it is shown: keep it to verify `Echdyn-Signature`.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_body", 'Send JSON, as in { "url": "https://example.com/hook" }');
  }
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  try {
    const endpoint = await createWebhookEndpoint(getServices().db, {
      url: fields.url,
      description: fields.description,
    });
    return Response.json({ ...endpointJson(endpoint), secret: endpoint.secret }, { status: 201 });
  } catch (error) {
    if (error instanceof WebhookError) {
      return problem(422, "invalid_webhook", error.message);
    }
    throw error;
  }
}
