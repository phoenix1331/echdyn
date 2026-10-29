import { describe, expect, it } from "vitest";
import { firstRow } from "./rows";

describe("firstRow", () => {
  it("returns the first row", () => {
    expect(firstRow([{ id: 1 }, { id: 2 }], "insert")).toEqual({ id: 1 });
  });

  it("throws with context when there are no rows", () => {
    expect(() => firstRow([], "document insert")).toThrow("document insert returned no row");
  });
});
