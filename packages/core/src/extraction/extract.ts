import type { ChatRequest, ChatResponse, Message } from "ollama";
import type { Database } from "../db/client";
import { firstRow } from "../db/rows";
import { extractions, type FieldError } from "../db/schema";
import { normalisePrinted, toPrintedSchema, type PrintedUnit } from "./printed";
import {
  buildMixedPrompt,
  buildTextPrompt,
  buildVisionPrompt,
  MIXED_PROMPT_VERSION,
  PROMPT_VERSION,
  VISION_PROMPT_VERSION,
  type MixedPage,
} from "./prompt";

export type Extraction = typeof extractions.$inferSelect;

/** The slice of the Ollama client the pipeline uses, so tests can supply a fake */
export interface ChatClient {
  chat: (request: ChatRequest & { stream?: false }) => Promise<ChatResponse>;
}

/** What the model reads: the text layer, page images for a scan, or both for a mixed document */
export type ExtractionSource =
  | { kind: "text"; pages: readonly string[] }
  | { kind: "images"; images: readonly Uint8Array[] }
  | { kind: "mixed"; pages: readonly MixedPage[] };

const PROMPTS = {
  text: PROMPT_VERSION,
  images: VISION_PROMPT_VERSION,
  mixed: MIXED_PROMPT_VERSION,
} as const;

export interface ExtractionInput {
  documentId: string;
  documentTypeName: string;
  /** The stored record schema; the model is sent its printed form */
  jsonSchema: Record<string, unknown>;
  source: ExtractionSource;
  runNumber: number;
  /** Document type specific lines appended to the system prompt */
  hints?: readonly string[];
  /** Fields whose printed values may be in another unit, e.g. a rate in £ stored in pence */
  units?: Readonly<Partial<Record<string, PrintedUnit>>>;
}

export interface ExtractionSettings {
  client: ChatClient;
  model: string;
  /** 0 for the primary run; a consistency run uses a little randomness so unsure fields disagree */
  temperature?: number;
}

function messagesFor({ source, documentTypeName, hints }: ExtractionInput): Message[] {
  if (source.kind === "text") {
    return buildTextPrompt(documentTypeName, source.pages, hints);
  }
  if (source.kind === "images") {
    return buildVisionPrompt(documentTypeName, source.images, hints);
  }
  return buildMixedPrompt(documentTypeName, source.pages, hints);
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
 * One model run over a document, stored as an `extractions` row. Text and scans differ only
 * in the messages: both get the same printed-value schema, parsing and validation.
 * Bad output is recorded, not thrown: it is a quality problem for review, not a reason to retry.
 * Transport errors (Ollama down, model missing) do throw, so the queue retries them.
 */
export async function extractFields(
  db: Database,
  { client, model, temperature = 0 }: ExtractionSettings,
  input: ExtractionInput,
): Promise<Extraction> {
  const { source } = input;
  const messages = messagesFor(input);
  const started = performance.now();
  const response = await client.chat({
    model,
    messages,
    // Only the text path keeps grammar-forced ISO dates; anything read from an image copies them
    format: toPrintedSchema(input.jsonSchema, { dates: source.kind !== "text" }),
    stream: false,
    options: { temperature },
  });
  const durationMs = Math.round(performance.now() - started);
  const rawOutput = response.message.content;
  const object = parseObject(rawOutput);
  // raw_output keeps the values as printed; parsed holds them in the schema's units
  const parsed = object ? normalisePrinted(input.jsonSchema, object, input.units) : null;

  const rows = await db
    .insert(extractions)
    .values({
      documentId: input.documentId,
      model,
      promptVersion: PROMPTS[source.kind],
      runNumber: input.runNumber,
      rawOutput,
      parsed,
      validationErrors: parsed ? [] : [INVALID_JSON_ERROR],
      durationMs,
    })
    .returning();

  return firstRow(rows, "extraction insert");
}
