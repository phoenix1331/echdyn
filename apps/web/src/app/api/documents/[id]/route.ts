import { estimateProcessingMs, getDocumentSummary } from "@echdyn/core";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/** Progress for one document: poll this after an upload until the status settles */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/documents/[id]">,
): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const { id } = await params;
  const { db } = getServices();
  const document = await getDocumentSummary(db, id);

  if (!document) {
    return Response.json(
      { error: { code: "not_found", message: `No document with id ${id}` } },
      { status: 404 },
    );
  }

  const active = document.status === "queued" || document.status === "extracting";
  return Response.json({
    id: document.id,
    filename: document.filename,
    document_type: document.documentType,
    status: document.status,
    stage: document.stage,
    error: document.error,
    flag_count: document.flagCount,
    page_count: document.pageCount,
    queue_ahead: document.queueAhead,
    // Only meaningful while waiting or running
    estimated_ms: active ? await estimateProcessingMs(db) : null,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  });
}
