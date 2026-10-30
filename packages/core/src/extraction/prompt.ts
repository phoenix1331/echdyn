import type { Message } from "ollama";

/**
 * Bump whenever the wording changes, so extractions and eval results stay comparable.
 * Document type hints are part of the prompt: changing them needs a bump too.
 */
export const PROMPT_VERSION = "text-v2";

export function buildTextPrompt(
  documentTypeName: string,
  pages: readonly string[],
  hints: readonly string[] = [],
): Message[] {
  const document = pages.map((text, i) => `--- page ${i + 1} ---\n${text}`).join("\n\n");

  return [
    {
      role: "system",
      content: [
        `You extract data from a ${documentTypeName}.`,
        "Return JSON matching the provided schema. Use each field's description to find the right value.",
        "Copy values exactly as printed, including currency symbols, units and thousands separators: do not convert, calculate, round or infer values that are not on the document.",
        "Write dates as YYYY-MM-DD.",
        ...hints,
      ].join("\n"),
    },
    { role: "user", content: document },
  ];
}
