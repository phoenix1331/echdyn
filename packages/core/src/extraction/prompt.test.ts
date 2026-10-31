import { describe, expect, it } from "vitest";
import {
  buildMixedPrompt,
  buildTextPrompt,
  buildVisionPrompt,
  MIXED_PROMPT_VERSION,
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

describe("buildMixedPrompt", () => {
  const image = new Uint8Array([1, 2, 3]);

  it("sends typed pages as text and scanned pages as images, each named by page", () => {
    const [system, user] = buildMixedPrompt("bill", [
      { pageNumber: 1, text: "Dear customer" },
      { pageNumber: 2, image },
      { pageNumber: 3, text: "Terms" },
    ]);

    expect(user?.content).toContain("Pages 1 and 3 are typed: the text is below.");
    expect(user?.content).toContain("Page 2 is scanned: the attached images, in order.");
    expect(user?.content).toContain("--- page 1 ---\nDear customer\n\n--- page 3 ---\nTerms");
    expect(user?.images).toEqual(["AQID"]);
    // Read from an image, so dates and rates are copied as printed, as for scans
    expect(system?.content).toContain("Copy dates exactly as printed");
  });

  it("lists longer runs of pages", () => {
    const [, user] = buildMixedPrompt("bill", [
      { pageNumber: 1, text: "a" },
      { pageNumber: 2, image },
      { pageNumber: 3, image },
      { pageNumber: 4, image },
    ]);

    expect(user?.content).toContain("Page 1 is typed");
    expect(user?.content).toContain("Pages 2, 3 and 4 are scanned");
    expect(user?.images).toHaveLength(3);
  });

  it("is versioned apart from the text and vision prompts", () => {
    expect(MIXED_PROMPT_VERSION).toMatch(/^mixed-v\d+$/);
    expect([PROMPT_VERSION, VISION_PROMPT_VERSION]).not.toContain(MIXED_PROMPT_VERSION);
  });
});
