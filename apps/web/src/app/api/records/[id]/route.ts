import { getRecord } from "@echdyn/core";
import { problem } from "@/lib/api/upload";
import { getAuthConfig, requireApiAuth } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { recordJson } from "@/lib/api/records";

/** One approved record with the run it came from and the reviewer's corrections */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/records/[id]">,
): Promise<Response> {
  const denied = requireApiAuth(request, getAuthConfig());
  if (denied) {
    return denied;
  }

  const { id } = await params;
  const record = await getRecord(getServices().db, id);
  if (!record) {
    return problem(404, "not_found", `No record with id ${id}`);
  }

  return Response.json({
    ...recordJson(record),
    extraction_id: record.extractionId,
    corrections: record.corrections.map((correction) => ({
      field: correction.field,
      old_value: correction.oldValue,
      new_value: correction.newValue,
      reviewer: correction.reviewer,
      created_at: correction.createdAt,
    })),
  });
}
