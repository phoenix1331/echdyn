import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { documents, documentTypes, extractions } from "../db/schema";
import { fakeChatClient as fakeClient } from "../testing/fake-chat-client";
import { extractText, INVALID_JSON_ERROR } from "./extract";
import { toPrintedSchema } from "./printed";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("extractText", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const schema = { type: "object", properties: { total_gbp: { type: "number" } } };
  let documentId: string;

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    const [type] = await db
      .insert(documentTypes)
      .values({ slug: "t", name: "T", version: 1, schema })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: type?.id ?? "",
        storageKey: "k",
        originalFilename: "f.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "f".repeat(64),
      })
      .returning();
    documentId = document?.id ?? "";
  });

  afterAll(async () => {
    await close();
  });

  const input = () => ({
    documentId,
    documentTypeName: "UK business energy bill",
    jsonSchema: schema,
    pages: ["Total amount due GBP 386.88"],
    runNumber: 1,
  });

  it("sends the printed form of the schema as the structured output format at temperature 0", async () => {
    const client = fakeClient(['{"total_gbp": 386.88}']);

    await extractText(db, { client, model: "llama3.2" }, input());

    expect(client.requests[0]).toMatchObject({
      model: "llama3.2",
      format: toPrintedSchema(schema),
      stream: false,
      options: { temperature: 0 },
    });
    expect(client.requests[0]?.messages?.[1]?.content).toContain("GBP 386.88");
  });

  it("uses the configured temperature for consistency runs", async () => {
    const client = fakeClient(["{}"]);

    await extractText(db, { client, model: "m", temperature: 0.4 }, input());

    expect(client.requests[0]?.options).toEqual({ temperature: 0.4 });
  });

  it("stores the run with parsed output, model, prompt version and timing", async () => {
    const client = fakeClient(['{"total_gbp": 386.88}']);

    const extraction = await extractText(db, { client, model: "llama3.2" }, input());

    const [row] = await db.select().from(extractions).where(eq(extractions.id, extraction.id));
    expect(row).toMatchObject({
      documentId,
      model: "llama3.2",
      promptVersion: "text-v2",
      runNumber: 1,
      rawOutput: '{"total_gbp": 386.88}',
      parsed: { total_gbp: 386.88 },
      validationErrors: [],
    });
    expect(row?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps printed values in raw output and parses them in the schema's units", async () => {
    const reply = '{"total_gbp": "£1,935.76"}';
    const client = fakeClient([reply]);

    const extraction = await extractText(
      db,
      { client, model: "m" },
      { ...input(), hints: ["Ignore payments."], units: { total_gbp: "pounds" } },
    );

    expect(extraction.rawOutput).toBe(reply);
    expect(extraction.parsed).toEqual({ total_gbp: 1935.76 });
    expect(client.requests[0]?.messages?.[0]?.content).toContain("Ignore payments.");
  });

  it.each([
    ["truncated JSON", '{"total_gbp": 38'],
    ["a JSON array", "[1, 2]"],
    ["a JSON scalar", "null"],
  ])("records %s as unparsed with a root error instead of throwing", async (_, reply) => {
    const extraction = await extractText(db, { client: fakeClient([reply]), model: "m" }, input());

    expect(extraction.parsed).toBeNull();
    expect(extraction.rawOutput).toBe(reply);
    expect(extraction.validationErrors).toEqual([INVALID_JSON_ERROR]);
  });

  it("throws transport errors without storing a row", async () => {
    const client = fakeClient([new Error("connect ECONNREFUSED ollama:11434")]);

    await expect(extractText(db, { client, model: "m" }, input())).rejects.toThrow("ECONNREFUSED");
    expect(await db.select().from(extractions)).toHaveLength(0);
  });
});
