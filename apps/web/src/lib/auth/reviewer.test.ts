import { describe, expect, it, vi } from "vitest";
import { createSessionToken } from "./session";

const auth = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct horse battery",
  API_TOKEN: "t".repeat(32),
  SESSION_SECRET: "s".repeat(32),
};
const jar = { get: vi.fn<(name: string) => { value: string } | undefined>() };

vi.mock("./config", () => ({ getAuthConfig: () => auth }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(jar) }));

const { currentReviewer } = await import("./reviewer");

describe("currentReviewer", () => {
  it("names the admin when the session cookie is valid", async () => {
    jar.get.mockReturnValue({ value: createSessionToken(auth.SESSION_SECRET, "admin") });

    expect(await currentReviewer()).toBe("admin");
    expect(jar.get).toHaveBeenCalledWith("echdyn_session");
  });

  it("returns null without a cookie, with a forged one, or once it has expired", async () => {
    jar.get.mockReturnValue(undefined);
    expect(await currentReviewer()).toBeNull();

    jar.get.mockReturnValue({ value: createSessionToken("x".repeat(32), "admin") });
    expect(await currentReviewer()).toBeNull();

    jar.get.mockReturnValue({ value: createSessionToken(auth.SESSION_SECRET, "admin", 0) });
    expect(await currentReviewer()).toBeNull();
  });
});
