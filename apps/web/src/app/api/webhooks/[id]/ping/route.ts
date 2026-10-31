import { pingWebhookEndpoint } from "@echdyn/core";
import { problem } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/** Queues a signed `ping` event, to check a receiver and its secret without approving anything */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/webhooks/[id]/ping">,
): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const { id } = await params;
  const { db, webhooks } = getServices();
  const deliveryId = /^[0-9a-f-]{36}$/i.test(id)
    ? await pingWebhookEndpoint(db, webhooks, id)
    : null;
  if (!deliveryId) {
    return problem(404, "not_found", `No webhook with id ${id}`);
  }
  return Response.json({ delivery_id: deliveryId }, { status: 202 });
}
