import { ingestDocument, listDocuments } from "@echdyn/core";
import { parseDocumentQuery } from "@/lib/api/documents-query";
import { ingestProblem, problem, readUpload } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/** Documents, newest first: filter by status, type and file name, as the list page does */
export async function GET(request: Request): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const filters = parseDocumentQuery(new URL(request.url).searchParams);
  if (typeof filters === "string") {
    return problem(422, "invalid_query", filters);
  }

  const page = await listDocuments(getServices().db, filters);
  return Response.json({
    documents: page.items.map((document) => ({
      id: document.id,
      filename: document.filename,
      document_type: document.documentType,
      status: document.status,
      stage: document.stage,
      error: document.error,
      flag_count: document.flagCount,
      page_count: document.pageCount,
      queue_ahead: document.queueAhead,
      created_at: document.createdAt,
      updated_at: document.updatedAt,
    })),
    page: page.page,
    page_size: page.pageSize,
    total: page.total,
  });
}

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
