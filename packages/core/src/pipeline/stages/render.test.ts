import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { documentPages, documents } from "../../db/schema";
import { seedDocumentTypes } from "../../document-types/seed";
import { ingestDocument } from "../../ingest/ingest";
import type { DocumentQueue } from "../../queue/queue";
import { createStorage, pageImageKey } from "../../storage/storage";
import { processDocument, type PipelineContext, type PipelineStage } from "../pipeline";
import { preProcessStage } from "./pre-process";
import { renderPagesStage, renderPdfPages } from "./render";

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;
const fixtures = resolve(import.meta.dirname, "../../../../../fixtures");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(resolve(fixtures, name)));
}

/** Share of pixels in a region darker than mid grey, i.e. ink */
async function inkIn(
  png: Uint8Array,
  region: { x: number; y: number; width: number; height: number },
): Promise<number> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(region.x, region.y, region.width, region.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 128) {
      dark++;
    }
  }
  return dark / (data.length / 4);
}

async function pages(count: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    pdf.addPage([595.28, 841.89]);
  }
  return pdf.save();
}

describe("renderPdfPages", () => {
  it("renders an A4 page at 150 DPI as a PNG, text included", async () => {
    const [page, ...rest] = await renderPdfPages(await fixture("sample-energy-bill.pdf"));

    expect(rest).toEqual([]);
    expect(page).toMatchObject({ pageNumber: 1, width: 1240, height: 1754 });
    expect([...(page?.png.slice(0, 8) ?? [])]).toEqual(PNG_SIGNATURE);
    // "Northern Power Ltd" uses an unembedded standard font: blank here means pdfjs lost it
    const heading = { x: 110, y: 90, width: 340, height: 50 };
    expect(await inkIn(page?.png ?? new Uint8Array(), heading)).toBeGreaterThan(0.05);
    // and the page behind the text is white, not transparent
    const margin = { x: 900, y: 1500, width: 200, height: 200 };
    expect(await inkIn(page?.png ?? new Uint8Array(), margin)).toBe(0);
  });

  it("keeps the longest edge within the cap", async () => {
    const [page] = await renderPdfPages(await fixture("sample-energy-bill.pdf"), { maxEdge: 500 });

    expect(page?.height).toBe(500);
    expect(page?.width).toBe(353);
  });

  it("renders only the pages asked for, skipping ones that do not exist", async () => {
    const images = await renderPdfPages(await pages(4), { pageNumbers: [2, 4, 9], dpi: 20 });

    expect(images.map((image) => image.pageNumber)).toEqual([2, 4]);
  });

  it("stops at the page limit", async () => {
    const images = await renderPdfPages(await pages(4), { maxPages: 2, dpi: 20 });

    expect(images.map((image) => image.pageNumber)).toEqual([1, 2]);
  });

  it("does not detach the caller's buffer", async () => {
    const file = await pages(1);
    await renderPdfPages(file, { dpi: 20 });

    expect(file.byteLength).toBeGreaterThan(0);
  });
});

describe.skipIf(!testUrl || !testBucket)("render stage", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const storage = createStorage({ ...loadConfig(), S3_BUCKET: testBucket ?? "" });
  const noopQueue = { add: () => Promise.resolve() } as unknown as DocumentQueue;
  let seen: PipelineContext | undefined;
  const capture: PipelineStage = {
    name: "capture",
    run: (ctx) => {
      seen = ctx;
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    await storage.ensureBucket();
  });

  beforeEach(async () => {
    seen = undefined;
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await seedDocumentTypes(db);
  });

  afterAll(async () => {
    await close();
  });

  async function ingest(name: string) {
    return ingestDocument(
      { db, storage, queue: noopQueue },
      { documentTypeSlug: "uk-energy-bill", filename: name, bytes: await fixture(name) },
    );
  }

  it("stores each scanned page beside the PDF and records it", async () => {
    const { id } = await ingest("scanned-energy-bill.pdf");
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    const key = pageImageKey("uk-energy-bill", document?.sha256 ?? "", 1);

    await processDocument({ db, storage }, id, [preProcessStage, renderPagesStage, capture]);

    expect(await db.select().from(documentPages)).toEqual([
      expect.objectContaining({
        documentId: id,
        pageNumber: 1,
        storageKey: key,
        width: 1240,
        height: 1754,
      }),
    ]);
    const stored = await storage.get(key);
    expect([...(stored?.slice(0, 8) ?? [])]).toEqual(PNG_SIGNATURE);
    expect(seen?.pages).toEqual([expect.objectContaining({ pageNumber: 1, storageKey: key })]);
    // The stage keeps the bytes it stored, for the vision stage to send without a fetch
    expect(Buffer.from(seen?.pages?.[0]?.png ?? []).equals(Buffer.from(stored ?? []))).toBe(true);
  });

  it("replaces the page rows when a retried job renders again", async () => {
    const { id } = await ingest("scanned-energy-bill.pdf");
    await processDocument({ db, storage }, id, [preProcessStage, renderPagesStage]);
    await db.update(documents).set({ status: "extracting" }).where(eq(documents.id, id));

    await processDocument({ db, storage }, id, [preProcessStage, renderPagesStage]);

    expect(await db.select().from(documentPages)).toHaveLength(1);
  });

  it("renders only the scanned page of a mixed document", async () => {
    const { id } = await ingest("mixed-energy-bill.pdf");

    await processDocument({ db, storage }, id, [preProcessStage, renderPagesStage, capture]);

    const rows = await db.select().from(documentPages);
    expect(rows.map((row) => row.pageNumber)).toEqual([2]);
    expect(seen?.pages?.map((page) => page.pageNumber)).toEqual([2]);
  });

  it("leaves documents with a text layer alone", async () => {
    const { id } = await ingest("sample-energy-bill.pdf");

    await processDocument({ db, storage }, id, [preProcessStage, renderPagesStage, capture]);

    expect(await db.select().from(documentPages)).toEqual([]);
    expect(seen?.pages).toBeUndefined();
  });

  it("does nothing when pre-processing has not run", async () => {
    const { id } = await ingest("scanned-energy-bill.pdf");

    await processDocument({ db, storage }, id, [renderPagesStage]);

    expect(await db.select().from(documentPages)).toEqual([]);
  });
});
