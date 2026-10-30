import { describe, expect, it } from "vitest";
import { listHref, parseListParams } from "./params";

describe("parseListParams", () => {
  it("reads status, type, search and page", () => {
    expect(
      parseListParams({ status: "needs_review", type: "uk-energy-bill", q: " march ", page: "3" }),
    ).toEqual({ status: "needs_review", type: "uk-energy-bill", q: "march", page: 3 });
  });

  it("defaults to the first page with no filters", () => {
    expect(parseListParams({})).toEqual({ page: 1 });
  });

  it.each([
    ["an unknown status", { status: "deleted" }],
    ["blank values", { type: "  ", q: "" }],
    ["a page below 2", { page: "0" }],
    ["a fractional page", { page: "2.5" }],
    ["a non-numeric page", { page: "two" }],
  ])("drops %s", (_, params) => {
    expect(parseListParams(params)).toEqual({ page: 1 });
  });

  it("takes the first of repeated values", () => {
    expect(parseListParams({ status: ["failed", "approved"] }).status).toBe("failed");
  });
});

describe("listHref", () => {
  const current = { status: "approved" as const, type: "invoice", q: "march", page: 3 };

  it("keeps the current filters and page", () => {
    expect(listHref(current)).toBe("/?status=approved&type=invoice&q=march&page=3");
  });

  it("goes back to page 1 when a filter changes", () => {
    expect(listHref(current, { status: "failed" })).toBe("/?status=failed&type=invoice&q=march");
  });

  it("clears a filter set to undefined", () => {
    expect(listHref(current, { status: undefined })).toBe("/?type=invoice&q=march");
  });

  it("changes page without touching filters", () => {
    expect(listHref(current, { page: 4 })).toBe("/?status=approved&type=invoice&q=march&page=4");
  });

  it("is the bare list with nothing set", () => {
    expect(listHref({ page: 1 })).toBe("/");
  });
});
