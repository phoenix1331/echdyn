import { WebhookError } from "@echdyn/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted with vi.mock, which runs before the rest of the file
const core = vi.hoisted(() => ({
  listWebhookEndpoints: vi.fn(),
  createWebhookEndpoint: vi.fn(),
  deactivateWebhookEndpoint: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  pingWebhookEndpoint: vi.fn(),
}));

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  ...Object.fromEntries(
    Object.entries(core).map(([name, fn]) => [
      name,
      (...args: unknown[]) => fn(...args) as unknown,
    ]),
  ),
}));
vi.mock("@/lib/services", () => ({ getServices: () => ({ db: "db", webhooks: "queue" }) }));

const apiToken = "t".repeat(32);
vi.mock("@/lib/auth/config", () => ({
  getAuthConfig: () => ({
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "correct horse battery",
    API_TOKEN: apiToken,
    SESSION_SECRET: "s".repeat(32),
  }),
}));

const list = await import("./route");
const one = await import("./[id]/route");
const deliveries = await import("./[id]/deliveries/route");
const ping = await import("./[id]/ping/route");

const auth = { authorization: `Bearer ${apiToken}` };
const at = new Date(Date.UTC(2026, 9, 31, 9));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (init: RequestInit = {}, withAuth = true) =>
  new Request("http://localhost/api/webhooks", {
    ...init,
    headers: { ...(withAuth ? auth : {}), ...(init.headers as Record<string, string>) },
  });
const id = "11111111-1111-1111-1111-111111111111";

describe("webhook API", () => {
  beforeEach(() => {
    for (const fn of Object.values(core)) {
      fn.mockReset();
    }
  });

  it("needs credentials everywhere", async () => {
    expect((await list.GET(request({}, false))).status).toBe(401);
    expect((await list.POST(request({ method: "POST" }, false))).status).toBe(401);
    expect((await one.DELETE(request({}, false), params(id))).status).toBe(401);
    expect((await deliveries.GET(request({}, false), params(id))).status).toBe(401);
    expect((await ping.POST(request({}, false), params(id))).status).toBe(401);
  });

  it("lists endpoints with their delivery counts and no secrets", async () => {
    core.listWebhookEndpoints.mockResolvedValue([
      {
        id,
        url: "https://example.com/hook",
        description: null,
        active: true,
        createdAt: at,
        deliveries: { pending: 1, delivered: 4, failed: 0 },
      },
    ]);

    expect(await (await list.GET(request())).json()).toEqual({
      webhooks: [
        {
          id,
          url: "https://example.com/hook",
          description: null,
          active: true,
          created_at: "2026-10-31T09:00:00.000Z",
          deliveries: { pending: 1, delivered: 4, failed: 0 },
        },
      ],
    });
  });

  it("creates an endpoint and shows its secret once", async () => {
    core.createWebhookEndpoint.mockResolvedValue({
      id,
      url: "https://example.com/hook",
      description: "Accounts",
      active: true,
      createdAt: at,
      secret: "whsec_abc",
    });

    const res = await list.POST(
      request({
        method: "POST",
        body: JSON.stringify({
          url: "https://example.com/hook",
          description: "Accounts",
          extra: 1,
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id, secret: "whsec_abc", description: "Accounts" });
    expect(core.createWebhookEndpoint).toHaveBeenCalledWith("db", {
      url: "https://example.com/hook",
      description: "Accounts",
    });
  });

  it("explains a bad body or URL, and lets unexpected errors through", async () => {
    expect((await list.POST(request({ method: "POST", body: "not json" }))).status).toBe(400);

    core.createWebhookEndpoint.mockRejectedValue(
      new WebhookError("Webhook URLs must use http or https"),
    );
    const res = await list.POST(request({ method: "POST", body: JSON.stringify("ftp://x") }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "invalid_webhook", message: "Webhook URLs must use http or https" },
    });
    expect(core.createWebhookEndpoint).toHaveBeenLastCalledWith("db", {
      url: undefined,
      description: undefined,
    });

    core.createWebhookEndpoint.mockRejectedValue(new Error("database down"));
    await expect(list.POST(request({ method: "POST", body: "{}" }))).rejects.toThrow(
      "database down",
    );
  });

  it("deactivates an endpoint, or says it does not exist", async () => {
    core.deactivateWebhookEndpoint.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect((await one.DELETE(request(), params(id))).status).toBe(204);
    expect((await one.DELETE(request(), params(id))).status).toBe(404);
  });

  it("shows an endpoint's delivery log", async () => {
    core.listWebhookDeliveries.mockResolvedValueOnce([
      {
        id: "d1",
        event: "record.approved",
        status: "failed",
        attempts: 8,
        lastStatusCode: 503,
        lastError: "Responded 503",
        lastAttemptAt: at,
        deliveredAt: null,
        createdAt: at,
      },
    ]);

    expect(await (await deliveries.GET(request(), params(id))).json()).toEqual({
      deliveries: [
        {
          id: "d1",
          event: "record.approved",
          status: "failed",
          attempts: 8,
          last_status_code: 503,
          last_error: "Responded 503",
          last_attempt_at: "2026-10-31T09:00:00.000Z",
          delivered_at: null,
          created_at: "2026-10-31T09:00:00.000Z",
        },
      ],
    });

    core.listWebhookDeliveries.mockResolvedValueOnce(null);
    expect((await deliveries.GET(request(), params(id))).status).toBe(404);
  });

  it("queues a ping, and is 404 for an unknown or malformed id", async () => {
    core.pingWebhookEndpoint.mockResolvedValueOnce("d1").mockResolvedValueOnce(null);

    const res = await ping.POST(request(), params(id));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ delivery_id: "d1" });
    expect(core.pingWebhookEndpoint).toHaveBeenCalledWith("db", "queue", id);

    expect((await ping.POST(request(), params(id))).status).toBe(404);
    expect((await ping.POST(request(), params("nope"))).status).toBe(404);
    expect(core.pingWebhookEndpoint).toHaveBeenCalledTimes(2);
  });
});
