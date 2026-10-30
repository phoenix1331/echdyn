import { afterEach, describe, expect, it, vi } from "vitest";

const ensureBucket = vi.fn(() => Promise.resolve(true));
const getAuthConfig = vi.fn();

vi.mock("./lib/auth/config", () => ({ getAuthConfig }));

vi.mock("@echdyn/core", () => ({
  loadConfig: () => ({ S3_BUCKET: "test" }),
  createStorage: () => ({ ensureBucket }),
}));

const { register } = await import("./instrumentation");

describe("register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    ensureBucket.mockClear();
    getAuthConfig.mockReset();
  });

  it("ensures the storage bucket exists on the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();

    expect(ensureBucket).toHaveBeenCalledOnce();
    expect(getAuthConfig).toHaveBeenCalledOnce();
  });

  it("fails start-up when the auth settings are invalid", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    getAuthConfig.mockImplementation(() => {
      throw new Error("Invalid auth configuration");
    });

    await expect(register()).rejects.toThrow("Invalid auth configuration");
    expect(ensureBucket).not.toHaveBeenCalled();
  });

  it("skips the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(ensureBucket).not.toHaveBeenCalled();
    expect(getAuthConfig).not.toHaveBeenCalled();
  });
});
