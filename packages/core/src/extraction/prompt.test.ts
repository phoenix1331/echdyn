import { describe, expect, it } from "vitest";
import { buildTextPrompt, PROMPT_VERSION } from "./prompt";

describe("buildTextPrompt", () => {
  const [system, user] = buildTextPrompt("UK business energy bill", ["first page", "second page"]);

  it("names the document type and forbids invented values", () => {
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("UK business energy bill");
    expect(system?.content).toMatch(/do not calculate, round or infer/);
  });

  it("labels each page", () => {
    expect(user).toEqual({
      role: "user",
      content: "--- page 1 ---\nfirst page\n\n--- page 2 ---\nsecond page",
    });
  });

  it("is versioned", () => {
    expect(PROMPT_VERSION).toBe("text-v1");
  });
});
