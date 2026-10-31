import type { DocumentReview, ReviewRun } from "@echdyn/core";
import { describe, expect, it } from "vitest";
import type { ReviewField } from "@/lib/review/fields";
import { auditTimeline, readings } from "./audit";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 31, 9, minute));

const run = (
  runNumber: number,
  parsed: Record<string, unknown> | null,
  minute: number,
): ReviewRun => ({
  runNumber,
  model: "llama3.2",
  promptVersion: "text-v2",
  parsed,
  printed: parsed,
  validationErrors: [],
  durationMs: 31_400,
  createdAt: at(minute),
});

const review = (overrides: Partial<DocumentReview> = {}): DocumentReview =>
  ({
    document: {
      filename: "march.pdf",
      createdAt: at(0),
      pageKinds: ["text", "scan"],
      flags: [
        { field: "vat_gbp", rule: "vat-amount", message: "Run 1: VAT is off" },
        { field: "vat_gbp", rule: "total-adds-up", message: "Run 1: Total is off" },
        { field: "total_gbp", rule: "total-adds-up", message: "Run 1: Total is off" },
      ],
    },
    schema: { properties: { vat_gbp: { type: "number" }, total_gbp: { type: "number" } } },
    runs: [
      run(1, { vat_gbp: 386.88, total_gbp: 386.88 }, 1),
      run(2, { vat_gbp: 64.48, total_gbp: 386.88 }, 2),
    ],
    record: {
      id: "r1",
      data: { vat_gbp: 64.48, total_gbp: 386.88 },
      approvedBy: "admin",
      approvedAt: at(9),
    },
    corrections: [
      { field: "vat_gbp", oldValue: 386.88, newValue: 64.48, reviewer: "admin", createdAt: at(9) },
    ],
    ...overrides,
  }) as unknown as DocumentReview;

const labels: Record<string, string> = { vat_gbp: "VAT", total_gbp: "Total" };
const labelOf = (key: string) => labels[key] ?? key;

describe("auditTimeline", () => {
  it("tells the story from upload to approval, in order", () => {
    expect(auditTimeline(review(), labelOf)).toEqual([
      { at: at(0), title: "Uploaded march.pdf", detail: "2 pages: 1 typed, 1 scanned" },
      { at: at(1), title: "Run 1 read by llama3.2", detail: "Prompt text-v2, 31.4 s" },
      { at: at(2), title: "Run 2 read by llama3.2", detail: "Prompt text-v2, 31.4 s" },
      {
        at: at(2),
        title: "Checks flagged 2 fields for review",
        detail: "VAT, Total",
        attention: true,
      },
      { at: at(9), title: "admin corrected VAT", detail: "386.88 to 64.48", attention: true },
      { at: at(9), title: "Approved by admin" },
    ]);
  });

  it("says when everything passed, marks unusable output and automatic approval", () => {
    const events = auditTimeline(
      review({
        document: { filename: "a.pdf", createdAt: at(0), pageKinds: null, flags: [] } as never,
        runs: [run(1, null, 1)],
        record: { id: "r1", data: {}, approvedBy: "auto", approvedAt: at(3) },
        corrections: [],
      }),
      labelOf,
    );

    expect(events.map((e) => e.title)).toEqual([
      "Uploaded a.pdf",
      "Run 1 read by llama3.2",
      "Every check passed and the runs agreed",
      "Approved automatically",
    ]);
    expect(events[0]).not.toHaveProperty("detail");
    expect(events[1]).toMatchObject({
      detail: "Prompt text-v2, 31.4 s, output was not usable JSON",
      attention: true,
    });
  });

  it("dates the checks at upload when no run happened, and stops before approval if none", () => {
    const events = auditTimeline(review({ runs: [], record: null, corrections: [] }), labelOf);

    expect(events.at(-1)).toMatchObject({ at: at(0), title: "Checks flagged 2 fields for review" });
  });
});

describe("readings", () => {
  const fields = [
    { key: "vat_gbp", label: "VAT", value: "£64.48", issues: [] },
    { key: "total_gbp", label: "Total", value: "£386.88", issues: [] },
  ] as unknown as ReviewField[];

  it("shows each run beside the approved value and marks where they differ", () => {
    expect(readings(review(), fields, { vat_gbp: { label: "VAT", currency: true } })).toEqual([
      {
        key: "vat_gbp",
        label: "VAT",
        runs: ["£386.88", "£64.48"],
        approved: "£64.48",
        differs: true,
      },
      {
        key: "total_gbp",
        label: "Total",
        runs: ["386.88", "386.88"],
        approved: "£386.88",
        differs: false,
      },
    ]);
  });

  it("marks a value changed from run 1 even when the runs agreed", () => {
    const agreed = review({
      runs: [run(1, { vat_gbp: 1, total_gbp: 2 }, 1), run(2, { vat_gbp: 1, total_gbp: 2 }, 2)],
      record: {
        id: "r1",
        data: { vat_gbp: 3, total_gbp: 2 },
        approvedBy: "admin",
        approvedAt: at(5),
      },
    });

    expect(readings(agreed, fields).map((r) => r.differs)).toEqual([true, false]);
  });
});
