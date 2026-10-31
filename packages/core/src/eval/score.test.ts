import { describe, expect, it } from "vitest";
import { median, scoreFields, summarise, valuesMatch, type DocumentResult } from "./score";

describe("valuesMatch", () => {
  it.each([
    [322.4, 322.4, true],
    [322.4, 322.40000000001, true],
    [322.4, 322.41, false],
    [322.4, "322.4", false],
    ["Severn Valley Energy", "  SEVERN VALLEY ENERGY ", true],
    ["AC-1029384", "AC-1O29384", false],
    ["2026-08-01", 20260801, false],
    [null, null, true],
  ])("%j vs %j -> %s", (expected, actual, match) => {
    expect(valuesMatch(expected, actual)).toBe(match);
  });
});

describe("scoreFields", () => {
  it("scores each expected field and records missing values as null", () => {
    expect(scoreFields({ a: 1, b: "x" }, { a: 1, extra: true })).toEqual({
      a: { expected: 1, actual: 1, correct: true },
      b: { expected: "x", actual: null, correct: false },
    });
  });

  it("marks every field wrong when nothing was extracted", () => {
    expect(Object.values(scoreFields({ a: 1, b: 2 }, null)).map((f) => f.correct)).toEqual([
      false,
      false,
    ]);
  });
});

describe("median", () => {
  it.each([
    [[], 0],
    [[5], 5],
    [[9, 1, 5], 5],
    [[4, 1, 3, 2], 2.5],
  ])("%j -> %d", (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});

describe("summarise", () => {
  const field = (correct: boolean) => ({ expected: 1, actual: correct ? 1 : 2, correct });
  const doc = (
    outcome: DocumentResult["outcome"],
    a: boolean,
    b: boolean,
    durationMs: number,
    layout = "x",
    set = "synthetic",
  ): DocumentResult => ({
    id: "d",
    model: "m",
    layout,
    set,
    readBy: set === "scanned" ? "vision" : "m",
    outcome,
    durationMs,
    fields: { a: field(a), b: field(b) },
  });

  it("aggregates accuracy, review share, silent errors and latency", () => {
    const summary = summarise("m", [
      doc("approved", true, true, 1000),
      doc("approved", true, false, 3000),
      doc("needs_review", false, true, 2000, "y"),
      doc("failed", false, false, 500, "y", "scanned"),
    ]);

    expect(summary).toEqual({
      model: "m",
      documents: 4,
      fieldAccuracy: 4 / 8,
      documentAccuracy: 1 / 4,
      accuracyByField: { a: 2 / 4, b: 2 / 4 },
      flaggedShare: 1 / 4,
      autoApproved: 2,
      approvedWithErrors: 1,
      failed: 1,
      medianDurationMs: 1500,
      byLayout: {
        x: { documents: 2, fieldAccuracy: 3 / 4, documentAccuracy: 1 / 2, flaggedShare: 0 },
        y: { documents: 2, fieldAccuracy: 1 / 4, documentAccuracy: 0, flaggedShare: 1 / 2 },
      },
      bySet: {
        synthetic: {
          documents: 3,
          fieldAccuracy: 4 / 6,
          documentAccuracy: 1 / 3,
          flaggedShare: 1 / 3,
          readBy: ["m"],
          medianDurationMs: 2000,
        },
        scanned: {
          documents: 1,
          fieldAccuracy: 0,
          documentAccuracy: 0,
          flaggedShare: 0,
          readBy: ["vision"],
          medianDurationMs: 500,
        },
      },
    });
  });

  it("handles an empty run", () => {
    expect(summarise("m", [])).toMatchObject({
      documents: 0,
      fieldAccuracy: 0,
      flaggedShare: 0,
      byLayout: {},
      bySet: {},
    });
  });
});
