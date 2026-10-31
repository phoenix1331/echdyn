import { IngestError, type IngestErrorCode } from "@echdyn/core";

const errorStatus: Record<IngestErrorCode, number> = {
  empty_file: 422,
  not_pdf: 415,
  too_large: 413,
  unknown_document_type: 422,
  unreadable_pdf: 422,
};

export function problem(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export interface UploadFields {
  filename: string;
  documentTypeSlug: string;
  bytes: Uint8Array;
}

/** The `file` and `document_type` fields both upload routes take, or the problem response */
export async function readUpload(request: Request): Promise<UploadFields | Response> {
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

  return {
    filename: file.name,
    documentTypeSlug: documentType,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/** An IngestError as its HTTP problem; anything else is rethrown for a 500 */
export function ingestProblem(error: unknown): Response {
  if (error instanceof IngestError) {
    return problem(errorStatus[error.code], error.code, error.message);
  }
  throw error;
}
