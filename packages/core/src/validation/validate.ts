import type { z } from "zod";
import type { FieldError } from "../db/schema";
import type { DocumentTypeDefinition } from "../document-types/registry";

export interface ValidationResult<T> {
  data: T | null;
  errors: FieldError[];
}

/**
 * Schema first (types, formats, required fields), then business rules.
 * Rules only run on schema-valid data, since they assume every field is present and typed.
 */
export function validateExtraction<TSchema extends z.ZodObject>(
  definition: DocumentTypeDefinition<TSchema>,
  parsed: unknown,
): ValidationResult<z.infer<TSchema>> {
  const result = definition.schema.safeParse(parsed);

  if (!result.success) {
    return {
      data: null,
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "_root",
        message: issue.message,
      })),
    };
  }

  const errors = definition.rules.flatMap((rule) => {
    const message = rule.check(result.data);
    return message === null
      ? []
      : rule.fields.map((field) => ({ field, message, rule: rule.name }));
  });

  return { data: result.data, errors };
}
