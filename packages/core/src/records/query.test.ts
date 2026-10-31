import { describe, expect, it } from "vitest";
import { parseFieldFilter, parseRecordQuery } from "./query";

const type = "uk-energy-bill";
const params = (query: string) => new URLSearchParams(query);

describe("parseFieldFilter", () => {
  it.each([
    [
      "unit_rate_pence:gt:30",
      { field: "unit_rate_pence", operator: "gt", value: 30, kind: "number" },
    ],
    [
      "vat_rate_percent:eq:5",
      { field: "vat_rate_percent", operator: "eq", value: 5, kind: "number" },
    ],
    [
      "billing_period_start:gte:2026-01-01",
      { field: "billing_period_start", operator: "gte", value: "2026-01-01", kind: "date" },
    ],
    [
      "supplier:contains:Severn",
      { field: "supplier", operator: "contains", value: "Severn", kind: "text" },
    ],
    // Only the first two colons split, so values may contain one
    [
      "account_number:eq:AC:123",
      { field: "account_number", operator: "eq", value: "AC:123", kind: "text" },
    ],
  ])("reads %s", (raw, expected) => {
    expect(parseFieldFilter(raw, type)).toEqual(expected);
  });

  it.each([
    ["owner:eq:x", /Unknown field "owner" for uk-energy-bill; use one of: supplier, /],
    ["supplier:gt:a", /"gt" does not apply to supplier \(text\); use one of: eq, ne, contains/],
    ["total_gbp:contains:1", /"contains" does not apply to total_gbp \(number\)/],
    ["total_gbp:gt:", /Give a value to compare total_gbp with/],
    ["total_gbp:gt:lots", /total_gbp is a number, but "lots" is not/],
    ["billing_period_end:lt:31/12/2026", /billing_period_end is a date: write it as YYYY-MM-DD/],
    ["billing_period_end:lt:2026-02-30", /write it as YYYY-MM-DD/],
  ])("refuses %s", (raw, message) => {
    expect(() => parseFieldFilter(raw, type)).toThrow(message);
  });

  it("knows no fields for a type that does not exist", () => {
    expect(() => parseFieldFilter("total_gbp:gt:1", "passport")).toThrow(/Unknown field/);
  });
});

describe("parseRecordQuery", () => {
  it("has sensible defaults", () => {
    expect(parseRecordQuery(params(""))).toEqual({ fields: [], page: 1, pageSize: 25 });
  });

  it("reads every filter", () => {
    expect(
      parseRecordQuery(
        params(
          "type=uk-energy-bill&approved_from=2026-10-01&approved_to=2026-10-31&filter=unit_rate_pence:gt:30&filter=supplier:contains:power&filter=&page=2&page_size=50",
        ),
      ),
    ).toEqual({
      documentType: type,
      approvedFrom: "2026-10-01",
      approvedTo: "2026-10-31",
      fields: [
        { field: "unit_rate_pence", operator: "gt", value: 30, kind: "number" },
        { field: "supplier", operator: "contains", value: "power", kind: "text" },
      ],
      page: 2,
      pageSize: 50,
    });
  });

  it.each([
    ["type=passport", /Unknown document type "passport"/],
    ["filter=total_gbp:gt:1", /Field filters need a document type/],
    ["approved_from=yesterday", /approved_from must be a date as YYYY-MM-DD/],
    ["approved_from=2026-10-31&approved_to=2026-10-01", /approved_from is after approved_to/],
    ["page=0", /page must be a whole number from 1 or more/],
    ["page=1.5", /page must be a whole number/],
    ["page_size=101", /page_size must be a whole number from 1 to 100/],
  ])("refuses %s", (query, message) => {
    expect(() => parseRecordQuery(params(query))).toThrow(message);
  });

  it("reads a text search", () => {
    expect(parseRecordQuery(params("q=%20northern%20")).search).toBe("northern");
    expect(parseRecordQuery(params("q=%20"))).not.toHaveProperty("search");
  });

  it("ignores blank values", () => {
    expect(parseRecordQuery(params("type=&approved_to=&page=&page_size= "))).toEqual({
      fields: [],
      page: 1,
      pageSize: 25,
    });
  });
});
