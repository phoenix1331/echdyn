import { getDocumentFile } from "@echdyn/core";
import { problem } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/** The source PDF, one click from any list: a redirect to a short-lived signed storage URL */
export async function GET(
  request: Request,
  { params }: RouteContext<"/documents/[id]/pdf">,
): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const { id } = await params;
  const { db, storage } = getServices();
  const file = await getDocumentFile(db, id);
  if (!file) {
    return problem(404, "not_found", `No document with id ${id}`);
  }

  return Response.redirect(await storage.signedUrl(file.storageKey, 15 * 60), 302);
}
