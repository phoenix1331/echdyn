import { beforeEach, describe, expect, it, vi } from "vitest";

const exportTable = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  exportTable: (...args: unknown[]) => exportTable(...args) as unknown,
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
    new Request(`http://localhost/api/records/export${query}`, {
      headers: auth ? { authorization: `Bearer ${apiToken}` } : {},
    }),
  );

const table = {
  documentType: "uk-energy-bill",
  columns: [
    { key: "supplier", label: "Supplier", kind: "text" },
    { key: "total_gbp", label: "Total", kind: "number" },
  ],
  rows: [["Northern Power Ltd", 386.88]],
  truncated: false,
};

describe("GET /api/records/export", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(Date.UTC(2026, 9, 31, 12)), toFake: ["Date"] });
    exportTable.mockReset().mockResolvedValue(table);
  });

  it("needs credentials", async () => {
    expect((await get("?type=uk-energy-bill", false)).status).toBe(401);
  });

  it("downloads CSV by default, with the record filters applied", async () => {
    const res = await get("?type=uk-energy-bill&filter=unit_rate_pence:gt:30");

    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="uk-energy-bill-records-2026-10-31.csv"',
    );
    expect(res.headers.get("x-echdyn-truncated")).toBeNull();
    expect(await res.text()).toBe("supplier,total_gbp\r\nNorthern Power Ltd,386.88\r\n");
    expect(exportTable).toHaveBeenCalledWith("db", {
      documentType: "uk-energy-bill",
      fields: [{ field: "unit_rate_pence", operator: "gt", value: 30, kind: "number" }],
      page: 1,
      pageSize: 25,
    });
  });

  it("downloads Excel, and flags an export cut short", async () => {
    exportTable.mockResolvedValue({ ...table, truncated: true });

    const res = await get("?type=uk-energy-bill&format=xlsx");

    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("x-echdyn-truncated")).toBe("true");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // An xlsx is a zip: "PK"
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("explains a bad format or query with 422", async () => {
    const bad = await get("?type=uk-energy-bill&format=pdf");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({
      error: { code: "invalid_query", message: 'format must be csv or xlsx, not "pdf"' },
    });

    expect((await get("?type=passport")).status).toBe(422);
    expect(exportTable).not.toHaveBeenCalled();
  });

  it("lets unexpected errors through", async () => {
    exportTable.mockRejectedValue(new Error("database down"));

    await expect(get("?type=uk-energy-bill")).rejects.toThrow("database down");
  });
});
