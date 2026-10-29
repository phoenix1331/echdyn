import { resolve } from "node:path";
import type { ChatRequest, ChatResponse } from "ollama";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createDatabase } from "../db/client";
import type { ChatClient } from "../extraction/extract";
import { createStorage } from "../storage/storage";
import { loadLabelledSet, type LabelledDocument } from "./labelled-set";
import { runEval } from "./run";

const testUrl = process.env.TEST_DATABASE_URL;
const testBucket = process.env.TEST_S3_BUCKET;

/** Answers from the labels, finding the bill by the account number in the prompt */
function labelClient(
  documents: readonly LabelledDocument[],
  behaviour: Record<string, (expected: Record<string, unknown>) => Record<string, unknown> | Error>,
): ChatClient {
  return {
    chat: (request: ChatRequest) => {
      const prompt = request.messages?.map((m) => m.content).join("\n") ?? "";
      const doc = documents.find((d) => prompt.includes(String(d.expected.account_number)));
      const reply = behaviour[request.model]?.(doc?.expected ?? {}) ?? {};
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve({
            message: { role: "assistant", content: JSON.stringify(reply) },
          } as ChatResponse);
    },
  };
}

describe.skipIf(!testUrl || !testBucket)("runEval", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 2 });
  const storage = createStorage({ ...loadConfig(), S3_BUCKET: testBucket ?? "" });
  let documents: LabelledDocument[];

  beforeAll(async () => {
    await storage.ensureBucket();
    const set = await loadLabelledSet(
      resolve(import.meta.dirname, "../../../../eval/sets/synthetic"),
    );
    documents = set.slice(0, 3);
  });

  afterAll(async () => {
    await close();
  });

  it("runs the real pipeline per model and scores the primary extraction", async () => {
    const progress: string[] = [];
    const client = labelClient(documents, {
      perfect: (expected) => expected,
      "vat-misreader": (expected) => ({ ...expected, vat_gbp: expected.total_gbp }),
    });

    const { summaries, results } = await runEval({
      documents,
      models: ["perfect", "vat-misreader"],
      deps: { db, storage },
      client,
      onProgress: (m) => progress.push(m),
    });

    expect(
      summaries.map((s) => [s.model, s.fieldAccuracy, s.flaggedShare, s.autoApproved]),
    ).toEqual([
      ["perfect", 1, 0, 3],
      ["vat-misreader", 11 / 12, 1, 0],
    ]);
    expect(results).toHaveLength(6);
    expect(results.find((r) => r.model === "vat-misreader")?.fields.vat_gbp?.correct).toBe(false);
    expect(progress[0]).toMatch(/^perfect 1\/3 bill-001: approved, 12\/12 fields, \d+\.\d s$/);
  });

  it("counts confident wrong answers that pass every check", async () => {
    // Wrong account number: no arithmetic rule covers it and both runs agree
    const client = labelClient(documents, {
      sneaky: (expected) => ({ ...expected, account_number: "WRONG-123" }),
    });

    const { summaries } = await runEval({
      documents: documents.slice(0, 1),
      models: ["sneaky"],
      deps: { db, storage },
      client,
    });

    expect(summaries[0]).toMatchObject({ autoApproved: 1, approvedWithErrors: 1 });
  });

  it("records pipeline failures without stopping the run", async () => {
    const client = labelClient(documents, { offline: () => new Error("connect ECONNREFUSED") });

    const { results, summaries } = await runEval({
      documents: documents.slice(0, 2),
      models: ["offline"],
      deps: { db, storage },
      client,
    });

    expect(results.map((r) => [r.outcome, r.error])).toEqual([
      ["failed", "connect ECONNREFUSED"],
      ["failed", "connect ECONNREFUSED"],
    ]);
    expect(summaries[0]?.fieldAccuracy).toBe(0);
  });
});
