import { IngestError } from "@echdyn/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inspectDocument = vi.fn();
const queueState = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  inspectDocument: (...args: unknown[]) => inspectDocument(...args) as unknown,
  queueState: (...args: unknown[]) => queueState(...args) as unknown,
}));
vi.mock("@/lib/services", () => ({ getServices: () => ({ db: "db" }) }));

const apiToken = "t".repeat(32);
vi.mock("@/lib/auth/config", () => ({
  getAuthConfig: () => ({
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "correct horse battery",
    API_TOKEN: apiToken,
    SESSION_SECRET: "s".repeat(32),
  }),
}));

const { POST } = await import("./route");

function request(fields: Record<string, string | File>, auth = true): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return new Request("http://localhost/api/documents/inspect", {
    method: "POST",
    body: form,
    headers: auth ? { authorization: `Bearer ${apiToken}` } : {},
  });
}

const pdf = new File(["%PDF-1.7 test"], "bill.pdf", { type: "application/pdf" });

describe("POST /api/documents/inspect", () => {
  beforeEach(() => {
    inspectDocument.mockReset();
    queueState.mockReset().mockResolvedValue({ ahead: 2, estimatedWaitMs: 60_000 });
  });

  it("needs credentials", async () => {
    expect(
      (await POST(request({ file: pdf, document_type: "uk-energy-bill" }, false))).status,
    ).toBe(401);
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it("describes the file and the queue in snake_case, like the rest of the API", async () => {
    inspectDocument.mockResolvedValue({
      filename: "bill.pdf",
      sizeBytes: 13,
      pageCount: 2,
      pageKinds: ["text", "scan"],
      path: "mixed",
      estimatedMs: 300_000,
      pagesNotRead: 0,
      duplicate: {
        id: "d1",
        filename: "march.pdf",
        status: "approved",
        createdAt: new Date(Date.UTC(2026, 9, 30)),
      },
    });

    const res = await POST(request({ file: pdf, document_type: "uk-energy-bill" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      filename: "bill.pdf",
      size_bytes: 13,
      page_count: 2,
      page_kinds: ["text", "scan"],
      path: "mixed",
      estimated_ms: 300_000,
      pages_not_read: 0,
      duplicate: {
        id: "d1",
        filename: "march.pdf",
        status: "approved",
        created_at: "2026-10-30T00:00:00.000Z",
      },
      queue: { ahead: 2, estimated_wait_ms: 60_000 },
    });
    expect(inspectDocument).toHaveBeenCalledWith("db", {
      filename: "bill.pdf",
      documentTypeSlug: "uk-energy-bill",
      bytes: expect.any(Uint8Array) as unknown,
    });
  });

  it("reports no duplicate as null", async () => {
    inspectDocument.mockResolvedValue({
      filename: "bill.pdf",
      sizeBytes: 13,
      pageCount: 1,
      pageKinds: ["text"],
      path: "text",
      estimatedMs: null,
      pagesNotRead: 0,
      duplicate: null,
    });

    const body = (await (await POST(request({ file: pdf, document_type: "x" }))).json()) as {
      duplicate: unknown;
    };

    expect(body.duplicate).toBeNull();
  });

  it("maps an unreadable PDF to 422 and missing fields as uploads do", async () => {
    inspectDocument.mockRejectedValue(new IngestError("unreadable_pdf", "Could not read the PDF"));

    const res = await POST(request({ file: pdf, document_type: "uk-energy-bill" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "unreadable_pdf", message: "Could not read the PDF" },
    });

    expect((await POST(request({ document_type: "uk-energy-bill" }))).status).toBe(422);
  });

  it("lets unexpected errors through", async () => {
    inspectDocument.mockRejectedValue(new Error("database down"));

    await expect(POST(request({ file: pdf, document_type: "x" }))).rejects.toThrow("database down");
  });
});
