import type { Message } from "ollama";

/** Bump whenever the wording changes, so extractions and eval results stay comparable */
export const PROMPT_VERSION = "text-v1";

export function buildTextPrompt(documentTypeName: string, pages: readonly string[]): Message[] {
  const document = pages.map((text, i) => `--- page ${i + 1} ---\n${text}`).join("\n\n");

  return [
    {
      role: "system",
      content: [
        `You extract data from a ${documentTypeName}.`,
        "Return JSON matching the provided schema. Use each field's description for its meaning and unit.",
        "Copy values exactly as printed: do not calculate, round or infer values that are not on the document.",
        "Convert dates to YYYY-MM-DD and amounts to plain numbers without currency symbols or thousands separators.",
      ].join("\n"),
    },
    { role: "user", content: document },
  ];
}
