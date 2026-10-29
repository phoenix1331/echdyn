import { describe, expect, it } from "vitest";
import { formatDate, formatGbp, formatKwh, formatNumber } from "./format";

describe("formatDate", () => {
  it.each([
    ["numeric", "01/08/2026"],
    ["long", "1 August 2026"],
    ["short", "01-Aug-26"],
  ] as const)("formats %s dates", (style, expected) => {
    expect(formatDate("2026-08-01", style)).toBe(expected);
  });
});

describe("number formatting", () => {
  it("uses UK thousands separators", () => {
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatGbp(1234.5)).toBe("£1,234.50");
    expect(formatGbp(1234.5, false)).toBe("1,234.50");
  });

  it("shows decimals on kWh only when present", () => {
    expect(formatKwh(1250)).toBe("1,250");
    expect(formatKwh(1250.4)).toBe("1,250.4");
  });
});
