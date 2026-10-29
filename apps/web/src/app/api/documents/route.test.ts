import { IngestError } from "@echdyn/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestDocument = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  ingestDocument: (...args: unknown[]) => ingestDocument(...args) as unknown,
}));
vi.mock("@/lib/services", () => ({ getServices: () => ({}) }));

const { POST } = await import("./route");

function upload(fields: Record<string, string | File>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return new Request("http://localhost/api/documents", { method: "POST", body: form });
}

const pdfFile = new File(["%PDF-1.7 test"], "bill.pdf", { type: "application/pdf" });

describe("POST /api/documents", () => {
  beforeEach(() => {
    ingestDocument.mockReset();
  });

  it("creates a document and returns 201", async () => {
    ingestDocument.mockResolvedValue({ id: "doc-1", status: "queued", duplicate: false });

    const res = await POST(upload({ file: pdfFile, document_type: "uk-energy-bill" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "doc-1", status: "queued", duplicate: false });
    expect(ingestDocument).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ documentTypeSlug: "uk-energy-bill", filename: "bill.pdf" }),
    );
  });

  it("returns 200 with the existing document for a duplicate", async () => {
    ingestDocument.mockResolvedValue({ id: "doc-1", status: "approved", duplicate: true });

    const res = await POST(upload({ file: pdfFile, document_type: "uk-energy-bill" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "doc-1", duplicate: true });
  });

  it("rejects a body that is not multipart", async () => {
    const res = await POST(
      new Request("http://localhost/api/documents", { method: "POST", body: "{}" }),
    );

    expect(res.status).toBe(400);
  });

  it("requires a file", async () => {
    const res = await POST(upload({ document_type: "uk-energy-bill" }));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "missing_file" } });
  });

  it("requires a document type", async () => {
    const res = await POST(upload({ file: pdfFile }));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "missing_document_type" } });
  });

  it.each([
    ["not_pdf", 415],
    ["too_large", 413],
    ["empty_file", 422],
    ["unknown_document_type", 422],
  ] as const)("maps %s to %i", async (code, status) => {
    ingestDocument.mockRejectedValue(new IngestError(code, "nope"));

    const res = await POST(upload({ file: pdfFile, document_type: "uk-energy-bill" }));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: "nope" } });
  });

  it("rethrows unexpected errors", async () => {
    ingestDocument.mockRejectedValue(new Error("boom"));

    await expect(POST(upload({ file: pdfFile, document_type: "uk-energy-bill" }))).rejects.toThrow(
      "boom",
    );
  });
});
