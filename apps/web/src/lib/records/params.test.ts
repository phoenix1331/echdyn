import { describe, expect, it } from "vitest";
import { exportHref, parseRecordListParams, recordListHref } from "./params";

describe("parseRecordListParams", () => {
  it("reads the filters with the API's names and checks", () => {
    const parsed = parseRecordListParams({
      q: " northern ",
      type: "uk-energy-bill",
      approved_from: "2026-10-01",
      approved_to: ["2026-10-31", "ignored"],
      page: "2",
    });

    expect(parsed.params).toEqual({
      q: "northern",
      type: "uk-energy-bill",
      approved_from: "2026-10-01",
      approved_to: "2026-10-31",
      page: 2,
    });
    expect(parsed.query).toMatchObject({
      search: "northern",
      documentType: "uk-energy-bill",
      approvedFrom: "2026-10-01",
      approvedTo: "2026-10-31",
      page: 2,
      pageSize: 25,
    });
    expect(parsed.problem).toBeUndefined();
  });

  it("defaults to page 1 for anything that is not a later page", () => {
    expect(parseRecordListParams({ page: "0" }).params.page).toBe(1);
    expect(parseRecordListParams({ page: "x" }).params.page).toBe(1);
    expect(parseRecordListParams({}).params).toEqual({ page: 1 });
  });

  it("reports a bad filter and keeps only the search", () => {
    const parsed = parseRecordListParams({ q: "severn", approved_from: "yesterday", type: "x" });

    expect(parsed.problem).toMatch(/Unknown document type "x"|approved_from must be a date/);
    expect(parsed.params).toEqual({ q: "severn", page: 1 });
    expect(parsed.query.search).toBe("severn");
  });
});

describe("recordListHref", () => {
  const current = { q: "northern", type: "uk-energy-bill", page: 3 };

  it("keeps the filters and moves between pages", () => {
    expect(recordListHref(current, { page: 4 })).toBe(
      "/records?q=northern&type=uk-energy-bill&page=4",
    );
  });

  it("goes back to page 1 when a filter changes", () => {
    expect(recordListHref(current, { q: "severn" })).toBe("/records?q=severn&type=uk-energy-bill");
    expect(recordListHref({ page: 1 })).toBe("/records");
  });
});

describe("exportHref", () => {
  it("exports what the list shows, for one type, without paging", () => {
    expect(
      exportHref({ q: "severn", approved_from: "2026-10-01", page: 3 }, "uk-energy-bill", "xlsx"),
    ).toBe("/api/records/export?q=severn&type=uk-energy-bill&approved_from=2026-10-01&format=xlsx");
  });
});
