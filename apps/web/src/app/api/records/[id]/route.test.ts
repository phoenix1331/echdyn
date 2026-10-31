import { beforeEach, describe, expect, it, vi } from "vitest";

const getRecord = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  getRecord: (...args: unknown[]) => getRecord(...args) as unknown,
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

const get = (id: string, auth = true) =>
  GET(
    new Request(`http://localhost/api/records/${id}`, {
      headers: auth ? { authorization: `Bearer ${apiToken}` } : {},
    }),
    { params: Promise.resolve({ id }) },
  );

describe("GET /api/records/:id", () => {
  beforeEach(() => {
    getRecord.mockReset();
  });

  it("needs credentials", async () => {
    expect((await get("r1", false)).status).toBe(401);
  });

  it("returns the record with its run and corrections", async () => {
    getRecord.mockResolvedValue({
      id: "r1",
      documentId: "d1",
      filename: "march.pdf",
      documentType: { slug: "uk-energy-bill", name: "UK business energy bill", version: 1 },
      data: { vat_gbp: 64.48 },
      approvedBy: "admin",
      approvedAt: new Date(Date.UTC(2026, 9, 31, 9)),
      extractionId: "e1",
      corrections: [
        {
          field: "vat_gbp",
          oldValue: 386.88,
          newValue: 64.48,
          reviewer: "admin",
          createdAt: new Date(Date.UTC(2026, 9, 31, 8, 59)),
        },
      ],
    });

    const res = await get("r1");

    expect(await res.json()).toMatchObject({
      id: "r1",
      data: { vat_gbp: 64.48 },
      extraction_id: "e1",
      corrections: [
        {
          field: "vat_gbp",
          old_value: 386.88,
          new_value: 64.48,
          reviewer: "admin",
          created_at: "2026-10-31T08:59:00.000Z",
        },
      ],
    });
    expect(getRecord).toHaveBeenCalledWith("db", "r1");
  });

  it("is 404 for an unknown record", async () => {
    getRecord.mockResolvedValue(null);

    const res = await get("nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "No record with id nope" },
    });
  });
});
