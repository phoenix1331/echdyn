import { describe, expect, it } from "vitest";
import {
  describeEstimate,
  describePages,
  describeQueue,
  PATH_LABELS,
  warningsFor,
  type InspectResponse,
} from "./summary";

const inspection = (overrides: Partial<InspectResponse> = {}): InspectResponse => ({
  filename: "bill.pdf",
  size_bytes: 1000,
  page_count: 1,
  page_kinds: ["text"],
  path: "text",
  estimated_ms: 32_000,
  pages_not_read: 0,
  duplicate: null,
  queue: { ahead: 0, estimated_wait_ms: null },
  ...overrides,
});

describe("describePages", () => {
  it.each([
    [["text"], "1 typed page"],
    [["scan", "scan"], "2 scanned pages"],
    [["text", "scan"], "2 pages: 1 typed, 1 scanned"],
    [["text", "text", "blank"], "3 pages: 2 typed, 1 blank"],
  ] as const)("%j reads %s", (kinds, expected) => {
    expect(describePages(kinds)).toBe(expected);
  });
});

describe("describeEstimate", () => {
  it("rounds the recent median into an estimate", () => {
    expect(describeEstimate(inspection())).toBe("about 30 s");
    expect(describeEstimate(inspection({ path: "vision", estimated_ms: 330_000 }))).toBe(
      "about 6 min",
    );
  });

  it("says so when there is nothing to go on, or nothing to read", () => {
    expect(describeEstimate(inspection({ estimated_ms: null }))).toBe("No timing history yet");
    expect(describeEstimate(inspection({ path: "none" }))).toBe("Goes straight to review");
  });
});

describe("warningsFor", () => {
  it("has none for a fresh typed bill", () => {
    expect(warningsFor(inspection())).toEqual([]);
  });

  it("links to the existing document for a duplicate", () => {
    const [warning] = warningsFor(
      inspection({
        duplicate: {
          id: "d1",
          filename: "march.pdf",
          status: "approved",
          created_at: "2026-10-30T09:00:00.000Z",
        },
      }),
    );

    expect(warning).toEqual({
      message: "Already uploaded on 30 Oct 2026 as march.pdf. Uploading again opens that one.",
      href: "/documents/d1",
    });
  });

  it("warns that scans are slow, that pages past the cap go unread, and when nothing can be read", () => {
    expect(
      warningsFor(inspection({ path: "mixed", pages_not_read: 1 })).map((w) => w.message),
    ).toEqual([
      expect.stringContaining("vision model, which is slow without a GPU"),
      "Only the first 10 scanned pages are read; 1 page will not be.",
    ]);
    expect(warningsFor(inspection({ path: "vision", pages_not_read: 3 }))[1]?.message).toContain(
      "3 pages will not be",
    );
    expect(warningsFor(inspection({ path: "none" }))[0]?.message).toContain("enter every field");
  });
});

describe("describeQueue", () => {
  it("is quiet when nothing is waiting", () => {
    expect(describeQueue({ ahead: 0, estimated_wait_ms: null })).toBeNull();
  });

  it("counts the documents ahead and how long they will take", () => {
    expect(describeQueue({ ahead: 1, estimated_wait_ms: null })).toBe("1 document ahead of these");
    expect(describeQueue({ ahead: 3, estimated_wait_ms: 120_000 })).toBe(
      "3 documents ahead of these, about 2 min to clear",
    );
  });
});

describe("PATH_LABELS", () => {
  it("has a reader-facing label for every path", () => {
    expect(Object.keys(PATH_LABELS).sort()).toEqual(["mixed", "none", "text", "vision"]);
  });
});
