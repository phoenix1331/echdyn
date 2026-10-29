import { PermanentPipelineError, StatusTransitionError, type Database } from "@echdyn/core";
import { UnrecoverableError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processDocument = vi.fn();
const transitionStatus = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  processDocument: (...args: unknown[]) => processDocument(...args) as unknown,
  transitionStatus: (...args: unknown[]) => transitionStatus(...args) as unknown,
}));

const { createProcessor } = await import("./worker");

const db = {} as Database;
const deps = { db, storage: {} as never };

function job(attemptsMade: number, attempts?: number) {
  return {
    data: { documentId: "doc-1" },
    attemptsMade,
    opts: attempts === undefined ? {} : { attempts },
  } as unknown as Job<{ documentId: string }>;
}

describe("createProcessor", () => {
  const logs: string[] = [];
  const processor = createProcessor(deps, [], (m) => logs.push(m));

  beforeEach(() => {
    processDocument.mockReset();
    transitionStatus.mockReset().mockResolvedValue(undefined);
    logs.length = 0;
  });

  it("returns the pipeline outcome", async () => {
    processDocument.mockResolvedValue("needs_review");

    await expect(processor(job(0, 3))).resolves.toBe("needs_review");
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it("requeues with the error noted when attempts remain", async () => {
    const error = new Error("ollama unreachable");
    processDocument.mockRejectedValue(error);

    await expect(processor(job(0, 3))).rejects.toBe(error);
    expect(transitionStatus).toHaveBeenCalledWith(
      db,
      "doc-1",
      "queued",
      "Retrying after error: ollama unreachable",
    );
    expect(logs).toEqual(["doc-1 failed (attempt 1): ollama unreachable"]);
  });

  it("marks the document failed on the last attempt", async () => {
    processDocument.mockRejectedValue(new Error("ollama unreachable"));

    await expect(processor(job(2, 3))).rejects.toThrow("ollama unreachable");
    expect(transitionStatus).toHaveBeenCalledWith(db, "doc-1", "failed", "ollama unreachable");
  });

  it("treats a job without retries as final", async () => {
    processDocument.mockRejectedValue("plain string failure");

    await expect(processor(job(0))).rejects.toBe("plain string failure");
    expect(transitionStatus).toHaveBeenCalledWith(db, "doc-1", "failed", "plain string failure");
  });

  it("fails permanent errors immediately without retrying", async () => {
    processDocument.mockRejectedValue(new PermanentPipelineError("file missing"));

    await expect(processor(job(0, 3))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(transitionStatus).toHaveBeenCalledWith(db, "doc-1", "failed", "file missing");
  });

  it("does not overwrite a document that has moved on (e.g. already approved)", async () => {
    processDocument.mockRejectedValue(new StatusTransitionError("doc-1", "extracting"));
    transitionStatus.mockRejectedValue(new StatusTransitionError("doc-1", "failed"));

    await expect(processor(job(0, 3))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("surfaces errors while recording the failure", async () => {
    processDocument.mockRejectedValue(new Error("stage failed"));
    transitionStatus.mockRejectedValue(new Error("database down"));

    await expect(processor(job(0, 3))).rejects.toThrow("database down");
  });
});
