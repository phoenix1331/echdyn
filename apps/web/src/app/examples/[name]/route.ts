import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { readExample } from "@/lib/upload/examples";

/** Serves the example bills listed in examples/examples.json, for the upload page */
export async function GET(
  request: Request,
  { params }: RouteContext<"/examples/[name]">,
): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const { name } = await params;
  const bytes = await readExample(name);
  if (!bytes) {
    return Response.json(
      { error: { code: "not_found", message: "No such example" } },
      { status: 404 },
    );
  }

  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, max-age=3600",
    },
  });
}
