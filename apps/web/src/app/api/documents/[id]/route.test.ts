import type { DocumentSummary } from "@echdyn/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocumentSummary = vi.fn();
const estimateProcessingMs = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  getDocumentSummary: (...args: unknown[]) => getDocumentSummary(...args) as unknown,
  estimateProcessingMs: (...args: unknown[]) => estimateProcessingMs(...args) as unknown,
}));
vi.mock("@/lib/services", () => ({ getServices: () => ({ db: {} }) }));

const apiToken = "t".repeat(32);
vi.mock("@/lib/auth/config", () => ({
  getAuthConfig: () => ({
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "correct horse battery",
    API_TOKEN: apiToken,
    SESSION_SECRET: "s".repeat(32),
  }),
}));

const { GET } = await import("./route");

const created = new Date("2026-10-30T12:00:00Z");
const summary = (overrides: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: "6f1c5c1e-0000-4000-8000-000000000001",
  filename: "bill.pdf",
  documentType: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
  status: "extracting",
  stage: "Reading PDF",
  error: null,
  flagCount: 0,
  pageCount: 2,
  createdAt: created,
  updatedAt: created,
  queueAhead: null,
  ...overrides,
});

function get(
  id: string,
  headers: Record<string, string> = { authorization: `Bearer ${apiToken}` },
) {
  return GET(new Request(`http://localhost/api/documents/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/documents/:id", () => {
  beforeEach(() => {
    getDocumentSummary.mockReset();
    estimateProcessingMs.mockReset().mockResolvedValue(40_000);
  });

  it("returns progress in snake_case with an estimate while processing", async () => {
    getDocumentSummary.mockResolvedValue(summary());

    const res = await get("6f1c5c1e-0000-4000-8000-000000000001");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "6f1c5c1e-0000-4000-8000-000000000001",
      filename: "bill.pdf",
      document_type: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
      status: "extracting",
      stage: "Reading PDF",
      error: null,
      flag_count: 0,
      page_count: 2,
      queue_ahead: null,
      estimated_ms: 40_000,
      created_at: "2026-10-30T12:00:00.000Z",
      updated_at: "2026-10-30T12:00:00.000Z",
    });
  });

  it("leaves out the estimate once the document has settled", async () => {
    getDocumentSummary.mockResolvedValue(
      summary({ status: "needs_review", stage: null, flagCount: 3 }),
    );

    const body = (await (await get("x")).json()) as Record<string, unknown>;

    expect(body).toMatchObject({ status: "needs_review", flag_count: 3, estimated_ms: null });
    expect(estimateProcessingMs).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown document", async () => {
    getDocumentSummary.mockResolvedValue(null);

    const res = await get("missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("requires credentials", async () => {
    const res = await get("x", {});

    expect(res.status).toBe(401);
    expect(getDocumentSummary).not.toHaveBeenCalled();
  });
});
