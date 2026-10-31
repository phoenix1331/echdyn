import { describe, expect, it } from "vitest";
import { approvedHref, parseApprovalForm, toReviewState } from "./approval";

function form(fields: [string, string | Blob][]): FormData {
  const data = new FormData();
  for (const [name, value] of fields) {
    data.append(name, value);
  }
  return data;
}

describe("parseApprovalForm", () => {
  it("collects typed corrections and both checkboxes", () => {
    expect(
      parseApprovalForm(
        form([
          ["correct.vat_gbp", "82.48"],
          ["correct.supplier", ""],
          ["override", "on"],
          ["label", "on"],
          ["$ACTION_ID_abc", ""],
        ]),
      ),
    ).toEqual({
      corrections: { vat_gbp: "82.48", supplier: "" },
      overrideChecks: true,
      addToLabelledSet: true,
    });
  });

  it("treats unticked boxes as off and ignores uploaded files", () => {
    expect(parseApprovalForm(form([["correct.total_gbp", new Blob(["x"])]]))).toEqual({
      corrections: {},
      overrideChecks: false,
      addToLabelledSet: false,
    });
  });
});

describe("toReviewState", () => {
  const fields = ["subtotal_gbp", "vat_gbp", "total_gbp"];

  it("groups rule errors by field, once each, and allows an override", () => {
    const message = "Subtotal + VAT = £10.00, but total is £12.00";
    const state = toReviewState(
      [
        { field: "subtotal_gbp", rule: "total-adds-up", message },
        { field: "total_gbp", rule: "total-adds-up", message },
        { field: "total_gbp", rule: "total-adds-up", message },
      ],
      fields,
    );

    expect(state).toEqual({
      fieldErrors: { subtotal_gbp: [message], total_gbp: [message] },
      general: [],
      canOverride: true,
    });
  });

  it("refuses an override when a value does not fit the schema, and keeps unknown fields general", () => {
    const state = toReviewState(
      [
        { field: "vat_gbp", message: "Invalid input: expected number, received string" },
        { field: "_root", message: "Not an object" },
      ],
      fields,
    );

    expect(state).toEqual({
      fieldErrors: { vat_gbp: ["Invalid input: expected number, received string"] },
      general: ["Not an object"],
      canOverride: false,
    });
  });

  it("offers no override when there is nothing to override", () => {
    expect(toReviewState([], fields).canOverride).toBe(false);
  });
});

describe("approvedHref", () => {
  it("returns to the document, reporting the labelled set outcome when one was asked for", () => {
    expect(approvedHref("abc")).toBe("/documents/abc");
    expect(approvedHref("abc", "reviewed-0123")).toBe("/documents/abc?labelled=reviewed-0123");
    expect(approvedHref("abc", false)).toBe("/documents/abc?labelled=failed");
  });
});
