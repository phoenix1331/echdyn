import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { documentTypes } from "../db/schema";
import { documentTypeRegistry, toJsonSchema, type DocumentTypeDefinition } from "./registry";

export interface SeedResult {
  inserted: string[];
  unchanged: string[];
}

export async function seedDocumentTypes(
  db: Database,
  definitions: readonly DocumentTypeDefinition[] = documentTypeRegistry,
): Promise<SeedResult> {
  const result: SeedResult = { inserted: [], unchanged: [] };

  for (const definition of definitions) {
    const label = `${definition.slug}@${definition.version}`;
    const schema = toJsonSchema(definition);
    const [existing] = await db
      .select()
      .from(documentTypes)
      .where(
        and(eq(documentTypes.slug, definition.slug), eq(documentTypes.version, definition.version)),
      );

    if (!existing) {
      await db.insert(documentTypes).values({
        slug: definition.slug,
        name: definition.name,
        version: definition.version,
        schema,
      });
      result.inserted.push(label);
      continue;
    }

    if (!isDeepStrictEqual(existing.schema, schema)) {
      throw new Error(
        `${label} is already stored with a different schema. Bump the version instead of editing a published schema.`,
      );
    }

    result.unchanged.push(label);
  }

  return result;
}
