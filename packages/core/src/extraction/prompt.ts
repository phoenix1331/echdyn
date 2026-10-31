import type { Message } from "ollama";

/**
 * Bump whenever the wording changes, so extractions and eval results stay comparable.
 * Document type hints are part of the prompt: changing them needs a bump too.
 */
export const PROMPT_VERSION = "text-v2";
/** The vision prompt is versioned separately: scans and text documents are measured apart */
export const VISION_PROMPT_VERSION = "vision-v2";

// The text path's grammar forces ISO dates; the vision path copies them as printed and code
// parses them, as a small vision model scrambles the digits when made to reformat
const ISO_DATES = "Write dates as YYYY-MM-DD.";
const PRINTED_DATES =
  "Copy dates exactly as printed too. Keep the £ or p on every rate and charge, even when it is printed apart from the number.";

function systemPrompt(
  documentTypeName: string,
  hints: readonly string[],
  dates: string = ISO_DATES,
): Message {
  return {
    role: "system",
    content: [
      `You extract data from a ${documentTypeName}.`,
      "Return JSON matching the provided schema. Use each field's description to find the right value.",
      "Copy values exactly as printed, including currency symbols, units and thousands separators: do not convert, calculate, round or infer values that are not on the document.",
      dates,
      ...hints,
    ].join("\n"),
  };
}

export function buildTextPrompt(
  documentTypeName: string,
  pages: readonly string[],
  hints: readonly string[] = [],
): Message[] {
  const document = pages.map((text, i) => `--- page ${i + 1} ---\n${text}`).join("\n\n");

  return [systemPrompt(documentTypeName, hints), { role: "user", content: document }];
}

/** Scanned pages go to a vision model as images, in page order; dates and rates are copied as printed */
export function buildVisionPrompt(
  documentTypeName: string,
  images: readonly Uint8Array[],
  hints: readonly string[] = [],
): Message[] {
  const count = images.length === 1 ? "1 page" : `${String(images.length)} pages`;

  return [
    systemPrompt(documentTypeName, hints, PRINTED_DATES),
    {
      role: "user",
      content: `The attached images are the ${count} of a scanned ${documentTypeName}, in order. Read the printed text in them.`,
      images: images.map((png) => Buffer.from(png).toString("base64")),
    },
  ];
}
