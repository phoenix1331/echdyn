import { describe, expect, it } from "vitest";
import { createRandom } from "./random";

describe("createRandom", () => {
  it("is deterministic for a seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);

    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it("produces values in range", () => {
    const random = createRandom(7);

    for (let i = 0; i < 500; i++) {
      const n = random.int(3, 5);
      const d = random.decimal(1, 2, 2);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(2);
      expect(Math.round(d * 100) / 100).toBe(d);
    }
  });

  it("picks items and honours chance extremes", () => {
    const random = createRandom(1);

    expect(["only"]).toContain(random.pick(["only"]));
    expect(random.chance(0)).toBe(false);
    expect(random.chance(1)).toBe(true);
  });

  it("refuses to pick from an empty list", () => {
    expect(() => createRandom(1).pick([])).toThrow("at least one item");
  });
});
