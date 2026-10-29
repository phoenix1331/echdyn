import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { documentTypes, extractions } from "../../db/schema";
import { seedDocumentTypes } from "../../document-types/seed";
import { INVALID_JSON_ERROR } from "../../extraction/extract";
import { ingestDocument } from "../../ingest/ingest";
import type { DocumentQueue } from "../../queue/queue";
import { createStorage } from "../../storage/storage";
import { fakeChatClient } from "../../testing/fake-chat-client";
import { PermanentPipelineError, processDocument } from "../pipeline";
import { createExtractStage } from "./extract";
import { preProcessStage } from "./pre-process";
import { validateStage } from "./validate";

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;
const fixtures = resolve(import.meta.dirname, "../../../../../fixtures");

const llamaOutput = {
  supplier: "Northern Power Ltd",
  account_number: "AC-1029384",
  meter_point_number: "1200023456781",
  billing_period_start: "2026-08-01",
  billing_period_end: "2026-08-31",
  consumption_kwh: 1250,
  unit_rate_pence: 24.5,
  standing_charge_pence_per_day: 52.1,
  subtotal_gbp: 322.4,
  vat_rate_percent: 20,
  vat_gbp: 386.88,
  total_gbp: 386.88,
};

describe.skipIf(!testUrl || !testBucket)("validate stage", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const storage = createStorage({ ...loadConfig(), S3_BUCKET: testBucket ?? "" });
  const noopQueue = { add: () => Promise.resolve() } as unknown as DocumentQueue;
  let documentId: string;

  beforeAll(async () => {
    await storage.ensureBucket();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate corrections, records, extractions, documents, document_types restart identity cascade`,
    );
    await seedDocumentTypes(db);
    const bytes = new Uint8Array(await readFile(resolve(fixtures, "sample-energy-bill.pdf")));
    documentId = (
      await ingestDocument(
        { db, storage, queue: noopQueue },
        { documentTypeSlug: "uk-energy-bill", filename: "bill.pdf", bytes },
      )
    ).id;
  });

  afterAll(async () => {
    await close();
  });

  function run(replies: string[]) {
    const extract = createExtractStage({ client: fakeChatClient(replies), model: "m" });
    return processDocument(
      { db, storage },
      documentId,
      replies
        .map(() => extract)
        .concat([preProcessStage])
        .reverse()
        .concat([validateStage]),
    );
  }

  it("stores rule failures on each extraction", async () => {
    await run([JSON.stringify(llamaOutput)]);

    const [row] = await db.select().from(extractions).where(eq(extractions.documentId, documentId));
    expect(row?.validationErrors.map((e) => e.field)).toContain("vat_gbp");
    expect(row?.validationErrors.every((e) => e.rule)).toBe(true);
  });

  it("leaves a clean extraction with no errors and keeps unparseable output's root error", async () => {
    await run([JSON.stringify({ ...llamaOutput, vat_gbp: 64.48 }), "not json"]);

    const rows = await db
      .select()
      .from(extractions)
      .where(eq(extractions.documentId, documentId))
      .orderBy(extractions.runNumber);
    expect(rows.map((r) => r.validationErrors)).toEqual([[], [INVALID_JSON_ERROR]]);
  });

  it("fails permanently when the stored version has no registered definition", async () => {
    await db.update(documentTypes).set({ version: 99 });

    await expect(run([JSON.stringify(llamaOutput)])).rejects.toBeInstanceOf(PermanentPipelineError);
  });
});
