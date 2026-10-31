import { beforeEach, describe, expect, it, vi } from "vitest";

const listRecords = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  listRecords: (...args: unknown[]) => listRecords(...args) as unknown,
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

const { GET } = await import("./route");

const get = (query: string, auth = true) =>
  GET(
    new Request(`http://localhost/api/records${query}`, {
      headers: auth ? { authorization: `Bearer ${apiToken}` } : {},
    }),
  );

const record = {
  id: "r1",
  documentId: "d1",
  filename: "march.pdf",
  documentType: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
  data: { unit_rate_pence: 33.57 },
  approvedBy: "admin",
  approvedAt: new Date(Date.UTC(2026, 9, 31, 9)),
};

describe("GET /api/records", () => {
  beforeEach(() => {
    listRecords.mockReset().mockResolvedValue({
      items: [record],
      total: 41,
      page: 2,
      pageSize: 25,
      pageCount: 2,
    });
  });

  it("needs credentials", async () => {
    expect((await get("", false)).status).toBe(401);
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("returns records in snake_case with paging, after parsing the filters", async () => {
    const res = await get("?type=uk-energy-bill&filter=unit_rate_pence:gt:30&page=2");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      records: [
        {
          id: "r1",
          document_id: "d1",
          filename: "march.pdf",
          document_type: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
          data: { unit_rate_pence: 33.57 },
          approved_by: "admin",
          approved_at: "2026-10-31T09:00:00.000Z",
        },
      ],
      page: 2,
      page_size: 25,
      total: 41,
    });
    expect(listRecords).toHaveBeenCalledWith("db", {
      documentType: "uk-energy-bill",
      fields: [{ field: "unit_rate_pence", operator: "gt", value: 30, kind: "number" }],
      page: 2,
      pageSize: 25,
    });
  });

  it("explains a bad query with 422", async () => {
    const res = await get("?filter=total_gbp:gt:1");

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_query",
        message: "Field filters need a document type, as in type=uk-energy-bill",
      },
    });
    expect(listRecords).not.toHaveBeenCalled();
  });
});
