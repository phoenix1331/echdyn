import { z } from "zod";
import type { BusinessRule } from "../validation/rules";
import { energyBill } from "./energy-bill";

export interface DocumentTypeDefinition<TSchema extends z.ZodObject = z.ZodObject> {
  slug: string;
  name: string;
  version: number;
  schema: TSchema;
  rules: readonly BusinessRule<z.infer<TSchema>>[];
}

export const documentTypeRegistry: readonly DocumentTypeDefinition[] = [energyBill];

/** Latest version of a slug, or an exact version when given */
export function findDocumentType(
  definitions: readonly DocumentTypeDefinition[],
  slug: string,
  version?: number,
): DocumentTypeDefinition | undefined {
  return definitions
    .filter((d) => d.slug === slug && (version === undefined || d.version === version))
    .sort((a, b) => b.version - a.version)[0];
}

export function getDocumentType(
  slug: string,
  version?: number,
): DocumentTypeDefinition | undefined {
  return findDocumentType(documentTypeRegistry, slug, version);
}

// Ollama compiles the schema into a decoding grammar, so heavy regex patterns
// (Zod's ISO date pattern) are dropped; Zod still validates the values strictly.
export function toJsonSchema(definition: DocumentTypeDefinition): Record<string, unknown> {
  return z.toJSONSchema(definition.schema, {
    target: "draft-7",
    override: (ctx) => {
      if (ctx.jsonSchema.format === "date") {
        delete ctx.jsonSchema.pattern;
      }
    },
  });
}
