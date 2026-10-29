import { describe, expect, it } from "vitest";
import { approxEqual, daysInclusive, gbp } from "./rules";

describe("approxEqual", () => {
  it("absorbs floating point noise", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(approxEqual(0.1 + 0.2, 0.3, 0)).toBe(true);
  });

  it("respects the tolerance boundary", () => {
    expect(approxEqual(10, 10.02, 0.02)).toBe(true);
    expect(approxEqual(10, 10.03, 0.02)).toBe(false);
  });
});

describe("daysInclusive", () => {
  it.each([
    ["2026-08-01", "2026-08-31", 31],
    ["2028-02-01", "2028-02-29", 29],
    ["2026-03-01", "2026-03-31", 31],
    ["2026-01-15", "2026-01-15", 1],
  ])("%s to %s is %i days", (start, end, days) => {
    expect(daysInclusive(start, end)).toBe(days);
  });
});

describe("gbp", () => {
  it("formats pounds to two decimal places", () => {
    expect(gbp(16.151)).toBe("£16.15");
    expect(gbp(64.4)).toBe("£64.40");
  });
});
