import { deactivateWebhookEndpoint } from "@echdyn/core";
import { problem } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/** Stops deliveries to the endpoint; its delivery log is kept */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/webhooks/[id]">,
): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const { id } = await params;
  if (!(await deactivateWebhookEndpoint(getServices().db, id))) {
    return problem(404, "not_found", `No webhook with id ${id}`);
  }
  return new Response(null, { status: 204 });
}
