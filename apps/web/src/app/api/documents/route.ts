import { IngestError, ingestDocument, type IngestErrorCode } from "@echdyn/core";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

const errorStatus: Record<IngestErrorCode, number> = {
  empty_file: 422,
  not_pdf: 415,
  too_large: 413,
  unknown_document_type: 422,
};

function problem(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return problem(400, "invalid_body", "Send the upload as multipart/form-data");
  }

  const file = form.get("file");
  const documentType = form.get("document_type");

  if (!(file instanceof File)) {
    return problem(422, "missing_file", 'Attach the PDF in a "file" field');
  }

  if (typeof documentType !== "string" || documentType === "") {
    return problem(422, "missing_document_type", 'Set the "document_type" field');
  }

  try {
    const result = await ingestDocument(getServices(), {
      documentTypeSlug: documentType,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    return Response.json(
      { id: result.id, status: result.status, duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof IngestError) {
      return problem(errorStatus[error.code], error.code, error.message);
    }
    throw error;
  }
}
