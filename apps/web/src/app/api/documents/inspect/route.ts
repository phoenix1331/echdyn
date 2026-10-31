import { inspectDocument, queueState } from "@echdyn/core";
import { ingestProblem, readUpload } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";

/**
 * A dry run of POST /api/documents: the same fields and checks, nothing stored or queued.
 * Says how the file would be read and roughly how long that takes, so a person (or an
 * integration) can decide before uploading.
 */
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
    const { db } = getServices();
    const [inspection, queue] = await Promise.all([inspectDocument(db, upload), queueState(db)]);

    return Response.json({
      filename: inspection.filename,
      size_bytes: inspection.sizeBytes,
      page_count: inspection.pageCount,
      page_kinds: inspection.pageKinds,
      path: inspection.path,
      estimated_ms: inspection.estimatedMs,
      pages_not_read: inspection.pagesNotRead,
      duplicate: inspection.duplicate && {
        id: inspection.duplicate.id,
        filename: inspection.duplicate.filename,
        status: inspection.duplicate.status,
        created_at: inspection.duplicate.createdAt.toISOString(),
      },
      queue: { ahead: queue.ahead, estimated_wait_ms: queue.estimatedWaitMs },
    });
  } catch (error) {
    return ingestProblem(error);
  }
}
