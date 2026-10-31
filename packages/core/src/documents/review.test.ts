import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client";
import { documents, documentTypes, extractions } from "../db/schema";
import { getDocumentReview } from "./review";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("getDocumentReview", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const schema = { type: "object", properties: { total_gbp: { type: "number" } } };
  let documentId: string;

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    const [type] = await db
      .insert(documentTypes)
      .values({ slug: "uk-energy-bill", name: "UK business energy bill", version: 1, schema })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        documentTypeId: type?.id ?? "",
        storageKey: "uk-energy-bill/ab/abc.pdf",
        originalFilename: "bill.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        status: "needs_review",
        hasTextLayer: true,
        flags: [{ field: "total_gbp", message: "Run 1: Subtotal + VAT = £10.00", rule: "x" }],
      })
      .returning();
    documentId = document?.id ?? "";
  });

  afterAll(async () => {
    await close();
  });

  async function run(runNumber: number, rawOutput: string, createdAt: Date, durationMs = 1000) {
    await db.insert(extractions).values({
      documentId,
      model: "llama3.2",
      promptVersion: "text-v2",
      runNumber,
      rawOutput,
      parsed: (() => {
        try {
          return {
            total_gbp: Number(
              (JSON.parse(rawOutput) as { total_gbp: string }).total_gbp.replace("£", ""),
            ),
          };
        } catch {
          return null;
        }
      })(),
      durationMs,
      createdAt,
    });
  }

  it("returns the document, its stored schema and each run with printed and parsed values", async () => {
    await run(1, '{"total_gbp": "£12.50"}', new Date(Date.UTC(2026, 9, 30, 9, 0)));
    await run(2, "not json", new Date(Date.UTC(2026, 9, 30, 9, 1)));

    const review = await getDocumentReview(db, documentId);

    expect(review?.document).toMatchObject({
      id: documentId,
      filename: "bill.pdf",
      status: "needs_review",
      storageKey: "uk-energy-bill/ab/abc.pdf",
      hasTextLayer: true,
      flags: [{ field: "total_gbp", rule: "x" }],
    });
    expect(review?.schema).toEqual(schema);
    expect(review?.runs).toEqual([
      expect.objectContaining({
        runNumber: 1,
        model: "llama3.2",
        promptVersion: "text-v2",
        parsed: { total_gbp: 12.5 },
        printed: { total_gbp: "£12.50" },
      }),
      expect.objectContaining({ runNumber: 2, parsed: null, printed: null }),
    ]);
  });

  it("keeps only the latest attempt at each run number after a retry", async () => {
    await run(1, '{"total_gbp": "£1.00"}', new Date(Date.UTC(2026, 9, 30, 9, 0)), 111);
    await run(1, '{"total_gbp": "£2.00"}', new Date(Date.UTC(2026, 9, 30, 9, 5)), 222);

    const review = await getDocumentReview(db, documentId);

    expect(review?.runs.map((r) => [r.runNumber, r.durationMs])).toEqual([[1, 222]]);
  });

  it("treats printed output that is not an object as unreadable", async () => {
    await run(1, "[1, 2]", new Date());

    expect((await getDocumentReview(db, documentId))?.runs[0]?.printed).toBeNull();
  });

  it("returns null for an unknown document", async () => {
    expect(await getDocumentReview(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
