import { ingestDocument } from "@echdyn/core";
import { ingestProblem, readUpload } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

export async function POST(request: Request): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const upload = await readUpload(request);
  if (upload instanceof Response) {
    return upload;
  }

  try {
    const result = await ingestDocument(getServices(), upload);

    return Response.json(
      { id: result.id, status: result.status, duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return ingestProblem(error);
  }
}
