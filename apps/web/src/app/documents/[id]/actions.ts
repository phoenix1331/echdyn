"use server";

import { appendToLabelledSet, approveDocument, ReviewError } from "@echdyn/core";
import { redirect } from "next/navigation";
import { currentReviewer } from "@/lib/auth/reviewer";
import {
  approvedHref,
  parseApprovalForm,
  toReviewState,
  type ReviewState,
} from "@/lib/review/approval";
import { getServices } from "@/lib/services";

export async function approveReview(
  documentId: string,
  _previous: ReviewState,
  form: FormData,
): Promise<ReviewState> {
  const reviewer = await currentReviewer();
  if (!reviewer) {
    redirect(`/login?next=${encodeURIComponent(`/documents/${documentId}`)}`);
  }

  const request = parseApprovalForm(form);
  const { db, storage, config } = getServices();

  let result;
  try {
    result = await approveDocument(db, documentId, {
      reviewer,
      corrections: request.corrections,
      overrideChecks: request.overrideChecks,
    });
  } catch (error) {
    if (error instanceof ReviewError) {
      return { general: [error.message] };
    }
    throw error;
  }

  if (!result.approved) {
    return toReviewState(result.errors, result.fields);
  }

  const dir = config.LABELLED_SET_DIR;
  if (!request.addToLabelledSet || !dir) {
    redirect(approvedHref(documentId));
  }

  // The record is already approved; a labelling problem is reported, not rolled back
  let labelled: string | false = false;
  try {
    const pdf = await storage.get(result.document.storageKey);
    if (pdf) {
      labelled = await appendToLabelledSet(dir, {
        documentType: result.document.slug,
        sha256: result.document.sha256,
        filename: result.document.filename,
        pdf,
        expected: result.data,
        reviewer,
      });
    }
  } catch (error) {
    console.error("Could not add the document to the labelled set", error);
  }
  redirect(approvedHref(documentId, labelled));
}
