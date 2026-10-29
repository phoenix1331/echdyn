import { describe, expect, it, vi } from "vitest";
import type { PipelineContext } from "../pipeline";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>()),
  getDocument: () => ({
    promise: Promise.reject(new Error("worker crashed")),
    destroy: () => Promise.resolve(),
  }),
}));

const { preProcessStage } = await import("./pre-process");

describe("preProcessStage errors", () => {
  it("rethrows unexpected errors so the queue can retry", async () => {
    const ctx = { file: new Uint8Array([1]) } as PipelineContext;

    await expect(preProcessStage.run(ctx)).rejects.toThrow("worker crashed");
  });
});
