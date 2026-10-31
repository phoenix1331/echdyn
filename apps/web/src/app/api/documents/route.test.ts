import { IngestError } from "@echdyn/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestDocument = vi.fn();
const listDocuments = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  ingestDocument: (...args: unknown[]) => ingestDocument(...args) as unknown,
  listDocuments: (...args: unknown[]) => listDocuments(...args) as unknown,
}));
vi.mock("@/lib/services", () => ({ getServices: () => ({}) }));

const apiToken = "t".repeat(32);
vi.mock("@/lib/auth/config", () => ({
  getAuthConfig: () => ({
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "correct horse battery",
    API_TOKEN: apiToken,
    SESSION_SECRET: "s".repeat(32),
  }),
}));

const { GET, POST } = await import("./route");

const authorised = { authorization: `Bearer ${apiToken}` };

function upload(
  fields: Record<string, string | File>,
  headers: Record<string, string> = authorised,
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return new Request("http://localhost/api/documents", { method: "POST", body: form, headers });
}

const pdfFile = new File(["%PDF-1.7 test"], "bill.pdf", { type: "application/pdf" });

describe("POST /api/documents", () => {
  beforeEach(() => {
    ingestDocument.mockReset();
  });

  it("rejects a request without credentials before reading the body", async () => {
    const res = await POST(upload({ file: pdfFile, document_type: "uk-energy-bill" }, {}));

    expect(res.status).toBe(401);
    expect(ingestDocument).not.toHaveBeenCalled();
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
      new Request("http://localhost/api/documents", {
        method: "POST",
        body: "{}",
        headers: authorised,
      }),
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

describe("GET /api/documents", () => {
  const list = (query: string, headers: Record<string, string> = authorised) =>
    GET(new Request(`http://localhost/api/documents${query}`, { headers }));

  beforeEach(() => {
    listDocuments.mockReset().mockResolvedValue({
      items: [
        {
          id: "d1",
          filename: "march.pdf",
          documentType: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
          status: "needs_review",
          stage: null,
          error: null,
          flagCount: 3,
          pageCount: 2,
          queueAhead: null,
          createdAt: new Date(Date.UTC(2026, 9, 31, 9)),
          updatedAt: new Date(Date.UTC(2026, 9, 31, 9, 1)),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    });
  });

  it("needs credentials", async () => {
    expect((await list("", {})).status).toBe(401);
  });

  it("lists documents in snake_case with the list page's filters", async () => {
    const res = await list("?status=needs_review&q=march");

    expect(await res.json()).toEqual({
      documents: [
        {
          id: "d1",
          filename: "march.pdf",
          document_type: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
          status: "needs_review",
          stage: null,
          error: null,
          flag_count: 3,
          page_count: 2,
          queue_ahead: null,
          created_at: "2026-10-31T09:00:00.000Z",
          updated_at: "2026-10-31T09:01:00.000Z",
        },
      ],
      page: 1,
      page_size: 25,
      total: 1,
    });
    // This file mocks services without a db
    expect(listDocuments).toHaveBeenCalledWith(undefined, {
      status: "needs_review",
      search: "march",
    });
  });

  it("explains a bad filter with 422 instead of ignoring it", async () => {
    const res = await list("?status=done");

    expect(res.status).toBe(422);
    expect(listDocuments).not.toHaveBeenCalled();
  });
});
