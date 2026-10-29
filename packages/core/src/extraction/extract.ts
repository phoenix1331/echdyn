import type { ChatRequest, ChatResponse } from "ollama";
import type { Database } from "../db/client";
import { firstRow } from "../db/rows";
import { extractions, type FieldError } from "../db/schema";
import { buildTextPrompt, PROMPT_VERSION } from "./prompt";

export type Extraction = typeof extractions.$inferSelect;

/** The slice of the Ollama client the pipeline uses, so tests can supply a fake */
export interface ChatClient {
  chat: (request: ChatRequest & { stream?: false }) => Promise<ChatResponse>;
}

export interface TextExtractionInput {
  documentId: string;
  documentTypeName: string;
  jsonSchema: Record<string, unknown>;
  pages: readonly string[];
  runNumber: number;
}

export interface ExtractionSettings {
  client: ChatClient;
  model: string;
}

export const INVALID_JSON_ERROR: FieldError = {
  field: "_root",
  message: "Model output is not valid JSON",
};

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * One model run over a text document, stored as an `extractions` row.
 * Bad output is recorded, not thrown: it is a quality problem for review, not a reason to retry.
 * Transport errors (Ollama down, model missing) do throw, so the queue retries them.
 */
export async function extractText(
  db: Database,
  { client, model }: ExtractionSettings,
  input: TextExtractionInput,
): Promise<Extraction> {
  const started = performance.now();
  const response = await client.chat({
    model,
    messages: buildTextPrompt(input.documentTypeName, input.pages),
    format: input.jsonSchema,
    stream: false,
    options: { temperature: 0 },
  });
  const durationMs = Math.round(performance.now() - started);
  const rawOutput = response.message.content;
  const parsed = parseObject(rawOutput);

  const rows = await db
    .insert(extractions)
    .values({
      documentId: input.documentId,
      model,
      promptVersion: PROMPT_VERSION,
      runNumber: input.runNumber,
      rawOutput,
      parsed,
      validationErrors: parsed ? [] : [INVALID_JSON_ERROR],
      durationMs,
    })
    .returning();

  return firstRow(rows, "extraction insert");
}
