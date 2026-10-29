import { sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { documentTypes } from "../db/schema";
import { energyBill } from "./energy-bill";
import { toJsonSchema } from "./registry";
import { seedDocumentTypes } from "./seed";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("seedDocumentTypes", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 1 });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
  });

  afterAll(async () => {
    await close();
  });

  it("inserts registered types with their JSON Schema", async () => {
    const result = await seedDocumentTypes(db);
    const rows = await db.select().from(documentTypes);

    expect(result).toEqual({ inserted: ["uk-energy-bill@1"], unchanged: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schema).toEqual(toJsonSchema(energyBill));
  });

  it("is idempotent", async () => {
    await seedDocumentTypes(db);
    const result = await seedDocumentTypes(db);

    expect(result).toEqual({ inserted: [], unchanged: ["uk-energy-bill@1"] });
    expect(await db.select().from(documentTypes)).toHaveLength(1);
  });

  it("refuses to overwrite a published schema without a version bump", async () => {
    await seedDocumentTypes(db);
    const edited = { ...energyBill, schema: energyBill.schema.extend({ tariff: z.string() }) };

    await expect(seedDocumentTypes(db, [edited])).rejects.toThrow(/Bump the version/);
  });

  it("stores a bumped version alongside the original", async () => {
    await seedDocumentTypes(db);
    const bumped = {
      ...energyBill,
      version: 2,
      schema: energyBill.schema.extend({ tariff: z.string() }),
    };

    await seedDocumentTypes(db, [bumped]);

    expect(await db.select().from(documentTypes)).toHaveLength(2);
  });
});
