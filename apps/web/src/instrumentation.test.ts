import { afterEach, describe, expect, it, vi } from "vitest";

const ensureBucket = vi.fn(() => Promise.resolve(true));

vi.mock("@echdyn/core", () => ({
  loadConfig: () => ({ S3_BUCKET: "test" }),
  createStorage: () => ({ ensureBucket }),
}));

const { register } = await import("./instrumentation");

describe("register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    ensureBucket.mockClear();
  });

  it("ensures the storage bucket exists on the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();

    expect(ensureBucket).toHaveBeenCalledOnce();
  });

  it("skips the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(ensureBucket).not.toHaveBeenCalled();
  });
});
