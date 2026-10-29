import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { documents, records } from "../../db/schema";
import { seedDocumentTypes } from "../../document-types/seed";
import type { Extraction } from "../../extraction/extract";
import { ingestDocument } from "../../ingest/ingest";
import type { DocumentQueue } from "../../queue/queue";
import { createStorage } from "../../storage/storage";
import { fakeChatClient } from "../../testing/fake-chat-client";
import {
  PermanentPipelineError,
  processDocument,
  type PipelineContext,
  type PipelineStage,
} from "../pipeline";
import { createExtractStage } from "./extract";
import { preProcessStage } from "./pre-process";
import { createScoreStage, mismatchedFields, scoreExtractions } from "./score";
import { validateStage } from "./validate";

const bill = {
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
  vat_gbp: 64.48,
  total_gbp: 386.88,
};

function extraction(runNumber: number, overrides: Partial<Extraction>): Extraction {
  return {
    id: `e${runNumber}`,
    documentId: "d",
    model: "m",
    promptVersion: "text-v1",
    runNumber,
    rawOutput: "",
    parsed: bill,
    validationErrors: [],
    durationMs: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("mismatchedFields", () => {
  it("finds fields that differ, ignoring surrounding whitespace", () => {
    expect(
      mismatchedFields([
        { a: 1, b: "x", c: true },
        { a: 2, b: " x ", c: true },
      ]),
    ).toEqual(["a"]);
  });

  it("treats a field missing from one run as a mismatch", () => {
    expect(mismatchedFields([{ a: 1 }, {}])).toEqual(["a"]);
  });
});

describe("scoreExtractions", () => {
  it("returns no flags when runs agree and validate", () => {
    expect(scoreExtractions([extraction(1, {}), extraction(2, {})])).toEqual([]);
  });

  it("prefixes validation errors with their run", () => {
    const flags = scoreExtractions([
      extraction(1, {
        validationErrors: [{ field: "vat_gbp", message: "bad", rule: "vat-amount" }],
      }),
    ]);

    expect(flags).toEqual([{ field: "vat_gbp", message: "Run 1: bad", rule: "vat-amount" }]);
  });

  it("flags fields the runs disagree on, showing both values", () => {
    const flags = scoreExtractions([
      extraction(1, {}),
      extraction(2, { parsed: { ...bill, account_number: "AC-1O29384" } }),
    ]);

    expect(flags).toEqual([
      {
        field: "account_number",
        rule: "run-mismatch",
        message: 'Runs disagree: "AC-1029384" vs "AC-1O29384"',
      },
    ]);
  });

  it("does not compare when a run produced no object", () => {
    const rootError = { field: "_root", message: "Model output is not valid JSON" };
    const flags = scoreExtractions([
      extraction(1, {}),
      extraction(2, { parsed: null, validationErrors: [rootError] }),
    ]);

    expect(flags).toEqual([{ ...rootError, message: "Run 2: Model output is not valid JSON" }]);
  });
});

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;
const fixtures = resolve(import.meta.dirname, "../../../../../fixtures");

describe.skipIf(!testUrl || !testBucket)("score stage", () => {
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

  async function upload(name = "sample-energy-bill.pdf"): Promise<string> {
    const bytes = new Uint8Array(await readFile(resolve(fixtures, name)));
    const { id } = await ingestDocument(
      { db, storage, queue: noopQueue },
      { documentTypeSlug: "uk-energy-bill", filename: name, bytes },
    );
    return id;
  }

  function pipeline(replies: object[], autoApprove = true, extra: PipelineStage[] = []) {
    const client = fakeChatClient(replies.map((r) => JSON.stringify(r)));
    return [
      preProcessStage,
      createExtractStage({ client, model: "m" }),
      createExtractStage({ client, model: "m", temperature: 0.4 }),
      validateStage,
      createScoreStage({ autoApprove }),
      ...extra,
    ];
  }

  async function documentRow(id: string) {
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    return row;
  }

  it("auto-approves a clean, consistent document into a record", async () => {
    const id = await upload();

    const outcome = await processDocument({ db, storage }, id, pipeline([bill, bill]));

    expect(outcome).toBe("approved");
    expect(await documentRow(id)).toMatchObject({ status: "approved", flags: [] });
    const [record] = await db.select().from(records).where(eq(records.documentId, id));
    expect(record).toMatchObject({ data: bill, approvedBy: "auto" });
  });

  it("sends inconsistent runs to review with the disputed field flagged", async () => {
    const id = await upload();

    await processDocument(
      { db, storage },
      id,
      pipeline([bill, { ...bill, consumption_kwh: 1520 }]),
    );

    const row = await documentRow(id);
    expect(row?.status).toBe("needs_review");
    expect(row?.flags.filter((f) => f.rule === "run-mismatch").map((f) => f.field)).toEqual([
      "consumption_kwh",
    ]);
    expect(await db.select().from(records)).toHaveLength(0);
  });

  it("sends validation failures to review", async () => {
    const id = await upload();
    const misread = { ...bill, vat_gbp: 386.88 };

    await processDocument({ db, storage }, id, pipeline([misread, misread]));

    const row = await documentRow(id);
    expect(row?.status).toBe("needs_review");
    expect(row?.flags.map((f) => f.field)).toContain("vat_gbp");
  });

  it("leaves clean documents for review when auto-approve is off", async () => {
    const id = await upload();

    await processDocument({ db, storage }, id, pipeline([bill, bill], false));

    expect(await documentRow(id)).toMatchObject({ status: "needs_review", flags: [] });
    expect(await db.select().from(records)).toHaveLength(0);
  });

  it("leaves a scan with nothing extracted for review", async () => {
    const id = await upload("scanned-energy-bill.pdf");

    await processDocument({ db, storage }, id, pipeline([]));

    expect(await documentRow(id)).toMatchObject({ status: "needs_review", flags: [] });
  });

  it("writes the record once if the stage runs again after a crash", async () => {
    const id = await upload();
    let captured: PipelineContext | undefined;
    const capture = {
      name: "capture",
      run: (ctx: PipelineContext) => {
        captured = ctx;
        return Promise.resolve();
      },
    };

    await processDocument({ db, storage }, id, pipeline([bill, bill], true, [capture]));
    await createScoreStage({ autoApprove: true }).run(captured as PipelineContext);

    expect(await db.select().from(records)).toHaveLength(1);
  });

  it("refuses to approve data that skipped validation", async () => {
    const id = await upload();
    const client = fakeChatClient([JSON.stringify({ supplier: "only one field" })]);

    await expect(
      processDocument({ db, storage }, id, [
        preProcessStage,
        createExtractStage({ client, model: "m" }),
        createScoreStage({ autoApprove: true }),
      ]),
    ).rejects.toBeInstanceOf(PermanentPipelineError);
  });
});
