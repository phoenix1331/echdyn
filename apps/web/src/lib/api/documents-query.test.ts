import { describe, expect, it } from "vitest";
import { parseDocumentQuery } from "./documents-query";

const parse = (query: string) => parseDocumentQuery(new URLSearchParams(query));

describe("parseDocumentQuery", () => {
  it("reads every filter", () => {
    expect(parse("status=needs_review&type=uk-energy-bill&q=march&page=2&page_size=50")).toEqual({
      status: "needs_review",
      documentType: "uk-energy-bill",
      search: "march",
      page: 2,
      pageSize: 50,
    });
  });

  it("has no filters by default, and ignores blanks", () => {
    expect(parse("")).toEqual({});
    expect(parse("status=&q=%20&page=")).toEqual({});
  });

  it.each([
    ["status=done", /status must be one of: queued, extracting, needs_review, approved, failed/],
    ["page=0", /page must be a whole number from 1 up/],
    ["page_size=101", /page_size must be a whole number from 1 to 100/],
    ["page_size=ten", /page_size must be a whole number/],
  ])("explains %s instead of ignoring it", (query, message) => {
    expect(parse(query)).toMatch(message);
  });
});
