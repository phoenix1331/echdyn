import type { Message } from "ollama";

/**
 * Bump whenever the wording changes, so extractions and eval results stay comparable.
 * Document type hints are part of the prompt: changing them needs a bump too.
 */
export const PROMPT_VERSION = "text-v2";
/** The vision prompt is versioned separately: scans and text documents are measured apart */
export const VISION_PROMPT_VERSION = "vision-v2";
/** Documents with both typed and scanned pages, read by the vision model in one request */
export const MIXED_PROMPT_VERSION = "mixed-v1";

/** One page of a mixed document: its text layer, or its rendered image */
export type MixedPage =
  { pageNumber: number; text: string } | { pageNumber: number; image: Uint8Array };

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

function pageList(numbers: readonly number[]): string {
  const [last, ...rest] = numbers.map(String).reverse();
  const listed =
    rest.length === 0 ? (last ?? "") : `${rest.reverse().join(", ")} and ${last ?? ""}`;
  return `${numbers.length === 1 ? "Page" : "Pages"} ${listed}`;
}

/**
 * A document with typed and scanned pages, in one request so the model sees the whole bill:
 * typed pages as text (no vision cost), scanned pages as images, both labelled by page.
 * Dates and rates are copied as printed, as for scans.
 */
export function buildMixedPrompt(
  documentTypeName: string,
  pages: readonly MixedPage[],
  hints: readonly string[] = [],
): Message[] {
  const typed = pages.filter((page) => "text" in page);
  const scanned = pages.filter((page) => "image" in page);
  const intro = [
    `This ${documentTypeName} has typed and scanned pages.`,
    `${pageList(typed.map((page) => page.pageNumber))} ${typed.length === 1 ? "is" : "are"} typed: the text is below.`,
    `${pageList(scanned.map((page) => page.pageNumber))} ${scanned.length === 1 ? "is" : "are"} scanned: the attached images, in order. Read the printed text in them.`,
  ].join(" ");
  const text = typed
    .map((page) => `--- page ${String(page.pageNumber)} ---\n${page.text}`)
    .join("\n\n");

  return [
    systemPrompt(documentTypeName, hints, PRINTED_DATES),
    {
      role: "user",
      content: `${intro}\n\n${text}`,
      images: scanned.map((page) => Buffer.from(page.image).toString("base64")),
    },
  ];
}
