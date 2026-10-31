import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deliverWebhook = vi.fn();
const markDeliveryFailed = vi.fn();

vi.mock("@echdyn/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echdyn/core")>()),
  deliverWebhook: (...args: unknown[]) => deliverWebhook(...args) as unknown,
  markDeliveryFailed: (...args: unknown[]) => markDeliveryFailed(...args) as unknown,
}));

const { createWebhookProcessor, createWebhookWorker } = await import("./webhooks");

const job = (attemptsMade: number) =>
  ({ data: { deliveryId: "d1" }, attemptsMade, opts: { attempts: 8 } }) as unknown as Job<{
    deliveryId: string;
  }>;

describe("createWebhookProcessor", () => {
  const log = vi.fn();
  const db = "db" as never;

  beforeEach(() => {
    deliverWebhook.mockReset();
    markDeliveryFailed.mockReset();
    log.mockReset();
  });

  it("delivers and reports the outcome", async () => {
    deliverWebhook.mockResolvedValue("delivered");

    expect(await createWebhookProcessor(db, log, { timeoutMs: 5 })(job(0))).toBe("delivered");
    expect(deliverWebhook).toHaveBeenCalledWith(db, "d1", { timeoutMs: 5 });
  });

  it("rethrows a failure so BullMQ retries, without marking it failed yet", async () => {
    deliverWebhook.mockRejectedValue(new Error("Responded 503"));

    await expect(createWebhookProcessor(db, log)(job(2))).rejects.toThrow("Responded 503");
    expect(markDeliveryFailed).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("webhook d1 failed (attempt 3): Responded 503");
  });

  it("marks the delivery failed on the last attempt", async () => {
    deliverWebhook.mockRejectedValue("refused");

    await expect(createWebhookProcessor(db, log)(job(7))).rejects.toBe("refused");
    expect(markDeliveryFailed).toHaveBeenCalledWith(db, "d1");
  });
});

describe("createWebhookWorker", () => {
  it("listens on the webhooks queue with several deliveries at once", async () => {
    const worker = createWebhookWorker({
      db: "db" as never,
      connection: { duplicate: vi.fn() } as never,
      // Not started against Redis: only its settings are checked
      prefix: "echdyn-test-webhooks",
    });

    expect(worker.name).toBe("webhooks");
    expect(worker.opts.concurrency).toBe(5);
    expect(worker.opts.prefix).toBe("echdyn-test-webhooks");
    await worker.close(true).catch(() => undefined);
  });
});
