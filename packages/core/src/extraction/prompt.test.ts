import { describe, expect, it } from "vitest";
import {
  buildTextPrompt,
  buildVisionPrompt,
  PROMPT_VERSION,
  VISION_PROMPT_VERSION,
} from "./prompt";

describe("buildTextPrompt", () => {
  const [system, user] = buildTextPrompt("UK business energy bill", ["first page", "second page"]);

  it("names the document type and asks for values as printed, never invented", () => {
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("UK business energy bill");
    expect(system?.content).toMatch(/Copy values exactly as printed/);
    expect(system?.content).toMatch(/do not convert, calculate, round or infer/);
  });

  it("appends document type hints to the system message", () => {
    const [withHints] = buildTextPrompt("bill", ["page"], ["Ignore payments."]);

    expect(withHints?.content).toMatch(/\nIgnore payments\.$/);
  });

  it("labels each page", () => {
    expect(user).toEqual({
      role: "user",
      content: "--- page 1 ---\nfirst page\n\n--- page 2 ---\nsecond page",
    });
  });

  it("is versioned", () => {
    expect(PROMPT_VERSION).toBe("text-v2");
  });
});

describe("buildVisionPrompt", () => {
  const png = new Uint8Array([1, 2, 3]);

  it("keeps the text prompt's instructions and hints, and attaches each page as an image", () => {
    const [system, user] = buildVisionPrompt(
      "UK business energy bill",
      [png],
      ["Ignore payments."],
    );

    expect(system?.content).toContain("Copy values exactly as printed");
    expect(system?.content).toContain("Ignore payments.");
    expect(user?.content).toContain("the 1 page of a scanned UK business energy bill");
    expect(user?.images).toEqual(["AQID"]);
  });

  it("asks for dates and pound signs as printed instead of converted", () => {
    const [system] = buildVisionPrompt("bill", [png]);
    const [textSystem] = buildTextPrompt("bill", ["x"]);

    expect(system?.content).toContain("Copy dates exactly as printed");
    expect(system?.content).toContain("Keep the £ or p");
    expect(system?.content).not.toContain("YYYY-MM-DD");
    expect(textSystem?.content).toContain("Write dates as YYYY-MM-DD.");
  });

  it("counts pages and keeps their order", () => {
    const [, user] = buildVisionPrompt("bill", [png, new Uint8Array([4])]);

    expect(user?.content).toContain("2 pages");
    expect(user?.images).toEqual(["AQID", "BA=="]);
  });

  it("is versioned apart from the text prompt", () => {
    expect(VISION_PROMPT_VERSION).toMatch(/^vision-v\d+$/);
    expect(VISION_PROMPT_VERSION).not.toBe(PROMPT_VERSION);
  });
});
