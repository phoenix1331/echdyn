import type { DocumentSummary } from "@echdyn/core";
import { describe, expect, it } from "vitest";
import { describeProgress, formatEstimate, formatRelative } from "./format";

const doc = (overrides: Partial<DocumentSummary>): DocumentSummary => ({
  id: "d",
  filename: "bill.pdf",
  documentType: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
  status: "queued",
  stage: null,
  error: null,
  flagCount: 0,
  pageCount: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  queueAhead: null,
  ...overrides,
});

describe("formatEstimate", () => {
  it.each([
    [1_000, "about 5 s"],
    [37_000, "about 35 s"],
    [39_800, "about 40 s"],
    [57_000, "about 55 s"],
    [59_000, "about 1 min"],
    [60_000, "about 1 min"],
    [130_000, "about 2 min"],
  ])("%d ms is %s", (ms, expected) => {
    expect(formatEstimate(ms)).toBe(expected);
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it.each([
    [ago(20_000), "just now"],
    [ago(5 * 60_000), "5 min ago"],
    [ago(3 * 3_600_000), "3 h ago"],
    [ago(30 * 3_600_000), "yesterday"],
    [new Date("2026-10-01T09:00:00Z"), "1 Oct 2026"],
  ])("%s reads %s", (date, expected) => {
    expect(formatRelative(date, now)).toBe(expected);
  });
});

describe("describeProgress", () => {
  it("puts a queued document's place in line and its wait", () => {
    expect(describeProgress(doc({ queueAhead: 0 }), 40_000)).toEqual({
      text: "Next in line",
      detail: "Done in about 40 s",
    });
    expect(describeProgress(doc({ queueAhead: 2 }), 40_000)).toEqual({
      text: "2 documents ahead",
      detail: "Done in about 2 min",
    });
    expect(describeProgress(doc({ queueAhead: 1 }), null)).toEqual({ text: "1 document ahead" });
  });

  it("shows the running stage as active, with the usual duration", () => {
    expect(
      describeProgress(
        doc({ status: "extracting", stage: "Extracting fields (run 1 of 2)" }),
        40_000,
      ),
    ).toEqual({
      text: "Extracting fields (run 1 of 2)",
      detail: "Usually takes about 40 s",
      active: true,
    });
    expect(describeProgress(doc({ status: "extracting" }), null)).toEqual({
      text: "Starting",
      active: true,
    });
  });

  it("tells the reviewer how much to check", () => {
    expect(describeProgress(doc({ status: "needs_review", flagCount: 1 }), null).text).toBe(
      "1 field to check",
    );
    expect(describeProgress(doc({ status: "needs_review", flagCount: 4 }), null).text).toBe(
      "4 fields to check",
    );
    expect(describeProgress(doc({ status: "needs_review" }), null).text).toBe("Check every field");
  });

  it("explains a failure and confirms an approval", () => {
    expect(describeProgress(doc({ status: "failed", error: "PDF is corrupt" }), null).text).toBe(
      "PDF is corrupt",
    );
    expect(describeProgress(doc({ status: "failed" }), null).text).toBe("Processing failed");
    expect(describeProgress(doc({ status: "approved" }), null).text).toBe("All fields checked");
  });
});
