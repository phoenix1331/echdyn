import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthConfig, loadAuthConfig } from "./config";

const valid = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct horse battery",
  API_TOKEN: "t".repeat(32),
  SESSION_SECRET: "s".repeat(32),
};

describe("loadAuthConfig", () => {
  it("returns the four auth settings", () => {
    expect(loadAuthConfig({ ...valid, UNRELATED: "x" })).toEqual(valid);
  });

  it.each([
    ["a missing username", { ...valid, ADMIN_USERNAME: undefined }, /ADMIN_USERNAME/],
    ["a short password", { ...valid, ADMIN_PASSWORD: "short" }, /at least 12/],
    ["a short API token", { ...valid, API_TOKEN: "abc" }, /API_TOKEN must be at least 32/],
    ["a short session secret", { ...valid, SESSION_SECRET: "abc" }, /SESSION_SECRET/],
  ])("rejects %s", (_, env, message) => {
    expect(() => loadAuthConfig(env)).toThrow(message);
  });
});

describe("getAuthConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the environment once and reuses the result", () => {
    for (const [key, value] of Object.entries(valid)) {
      vi.stubEnv(key, value);
    }
    const first = getAuthConfig();
    vi.stubEnv("ADMIN_USERNAME", "someone-else");

    expect(getAuthConfig()).toBe(first);
    expect(first.ADMIN_USERNAME).toBe("admin");
  });
});
