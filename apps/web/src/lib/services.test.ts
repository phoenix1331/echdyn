import { describe, expect, it, vi } from "vitest";

const createDatabase = vi.fn(() => ({ db: { name: "db" }, close: vi.fn() }));
const createStorage = vi.fn(() => ({ name: "storage" }));
const createRedisConnection = vi.fn(() => ({ name: "redis" }));
const createDocumentQueue = vi.fn(() => ({ name: "queue" }));
const createWebhookQueue = vi.fn(() => ({ name: "webhooks" }));

vi.mock("@echdyn/core", () => ({
  loadConfig: () => ({ DATABASE_URL: "postgres://db", REDIS_URL: "redis://redis" }),
  createDatabase,
  createStorage,
  createDocumentQueue,
  createRedisConnection,
  createWebhookQueue,
}));

const { getServices } = await import("./services");

describe("getServices", () => {
  it("creates clients once and reuses them", () => {
    const first = getServices();
    const second = getServices();

    expect(second).toBe(first);
    expect(first).toEqual({
      config: { DATABASE_URL: "postgres://db", REDIS_URL: "redis://redis" },
      db: { name: "db" },
      storage: { name: "storage" },
      queue: { name: "queue" },
      webhooks: { name: "webhooks" },
    });
    expect(createDatabase).toHaveBeenCalledOnce();
    expect(createRedisConnection).toHaveBeenCalledWith("redis://redis");
    expect(createDocumentQueue).toHaveBeenCalledWith({ name: "redis" });
    // One Redis connection shared by both queues
    expect(createRedisConnection).toHaveBeenCalledOnce();
    expect(createWebhookQueue).toHaveBeenCalledWith({ name: "redis" });
  });
});
