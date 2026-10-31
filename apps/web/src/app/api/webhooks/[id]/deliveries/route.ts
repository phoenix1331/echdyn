import { listWebhookDeliveries } from "@echdyn/core";
import { problem } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/** The latest 50 deliveries to one endpoint: what was sent, how it went, how often it was tried */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/webhooks/[id]/deliveries">,
): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const { id } = await params;
  const deliveries = await listWebhookDeliveries(getServices().db, id);
  if (!deliveries) {
    return problem(404, "not_found", `No webhook with id ${id}`);
  }

  return Response.json({
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      event: delivery.event,
      status: delivery.status,
      attempts: delivery.attempts,
      last_status_code: delivery.lastStatusCode,
      last_error: delivery.lastError,
      last_attempt_at: delivery.lastAttemptAt,
      delivered_at: delivery.deliveredAt,
      created_at: delivery.createdAt,
    })),
  });
}
