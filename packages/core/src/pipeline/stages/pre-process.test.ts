import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { documents } from "../../db/schema";
import { seedDocumentTypes } from "../../document-types/seed";
import { ingestDocument } from "../../ingest/ingest";
import type { DocumentQueue } from "../../queue/queue";
import { createStorage } from "../../storage/storage";
import { PermanentPipelineError, processDocument, type PipelineContext } from "../pipeline";
import { extractPdfText, preProcessStage } from "./pre-process";

const fixtures = resolve(import.meta.dirname, "../../../../../fixtures");
const fixture = (name: string) => readFile(resolve(fixtures, name)).then((b) => new Uint8Array(b));

describe("extractPdfText", () => {
  it("reads the text layer line by line", async () => {
    const text = await extractPdfText(await fixture("sample-energy-bill.pdf"));

    expect(text.pageCount).toBe(1);
    expect(text.hasTextLayer).toBe(true);
    expect(text.pages[0]?.split("\n")).toEqual(
      expect.arrayContaining(["Northern Power Ltd", "MPAN: 1200023456789"]),
    );
    expect(text.pages[0]).toContain("Total amount due");
  });

  it("flags a scanned, image-only PDF as having no text layer", async () => {
    const text = await extractPdfText(await fixture("scanned-energy-bill.pdf"));

    expect(text).toEqual({ pageCount: 1, pages: [""], hasTextLayer: false });
  });

  it("does not detach the caller's buffer", async () => {
    const file = await fixture("sample-energy-bill.pdf");

    await extractPdfText(file);

    expect(file.byteLength).toBeGreaterThan(0);
  });
});

describe("preProcessStage", () => {
  it("fails permanently on a corrupt PDF", async () => {
    const ctx = {
      file: new TextEncoder().encode("%PDF-1.7 not really a pdf"),
    } as PipelineContext;

    await expect(preProcessStage.run(ctx)).rejects.toBeInstanceOf(PermanentPipelineError);
  });
});

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;

describe.skipIf(!testUrl || !testBucket)("preProcessStage in the pipeline", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const storage = createStorage({ ...loadConfig(), S3_BUCKET: testBucket ?? "" });
  const noopQueue = { add: () => Promise.resolve() } as unknown as DocumentQueue;

  beforeAll(async () => {
    await storage.ensureBucket();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await seedDocumentTypes(db);
  });

  afterAll(async () => {
    await close();
  });

  it.each([
    ["sample-energy-bill.pdf", true],
    ["scanned-energy-bill.pdf", false],
  ])("records page count and text layer for %s", async (name, hasTextLayer) => {
    const { id } = await ingestDocument(
      { db, storage, queue: noopQueue },
      { documentTypeSlug: "uk-energy-bill", filename: name, bytes: await fixture(name) },
    );
    let seen: PipelineContext["text"];
    const capture = {
      name: "capture",
      run: (ctx: PipelineContext) => {
        seen = ctx.text;
        return Promise.resolve();
      },
    };

    await processDocument({ db, storage }, id, [preProcessStage, capture]);

    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row).toMatchObject({ pageCount: 1, hasTextLayer });
    expect(seen?.hasTextLayer).toBe(hasTextLayer);
  });
});
