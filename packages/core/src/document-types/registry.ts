import { z } from "zod";
import { energyBill } from "./energy-bill";

export interface DocumentTypeDefinition<TSchema extends z.ZodObject = z.ZodObject> {
  slug: string;
  name: string;
  version: number;
  schema: TSchema;
}

export const documentTypeRegistry: readonly DocumentTypeDefinition[] = [energyBill];

export function getDocumentType(slug: string): DocumentTypeDefinition | undefined {
  return documentTypeRegistry.find((definition) => definition.slug === slug);
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
