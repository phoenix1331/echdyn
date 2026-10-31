import { z } from "zod";
import type { PrintedUnit } from "../extraction/printed";
import type { BusinessRule } from "../validation/rules";
import { energyBill } from "./energy-bill";

/** How a field reads on the review screen */
export interface FieldDisplay {
  label: string;
  /** Written after the value, e.g. "kWh" or "p/kWh"; "%" is attached without a space */
  unit?: string;
  /** Pounds, shown as £1,234.56 */
  currency?: boolean;
}

export interface DocumentTypeDefinition<TSchema extends z.ZodObject = z.ZodObject> {
  slug: string;
  name: string;
  version: number;
  schema: TSchema;
  rules: readonly BusinessRule<z.infer<TSchema>>[];
  /** Review screen labels and units; fields without one get a label made from their name */
  display?: Readonly<Partial<Record<keyof z.infer<TSchema> & string, FieldDisplay>>>;
  extraction?: {
    /** Appended to the system prompt: where to look and which look-alike values to ignore */
    hints?: readonly string[];
    /** Numeric fields whose printed values may be in another unit */
    units?: Readonly<Partial<Record<keyof z.infer<TSchema> & string, PrintedUnit>>>;
  };
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
