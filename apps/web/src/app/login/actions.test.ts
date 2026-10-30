import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/auth";

const auth = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct horse battery",
  API_TOKEN: "t".repeat(32),
  SESSION_SECRET: "s".repeat(32),
};

const jar = { set: vi.fn(), delete: vi.fn() };
// Next's redirect() throws to stop the action; the mock does the same so code after it never runs
class Redirect extends Error {
  constructor(readonly path: string) {
    super(`redirect ${path}`);
  }
}

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => auth }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(jar) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Redirect(path);
  },
}));

const { login, logout } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

async function redirectOf(action: Promise<unknown>): Promise<string> {
  const error: unknown = await action.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Redirect);
  return (error as Redirect).path;
}

describe("login", () => {
  beforeEach(() => {
    jar.set.mockClear();
    jar.delete.mockClear();
  });

  it("sets a signed, http-only session cookie and redirects to the requested page", async () => {
    const path = await redirectOf(
      login({}, form({ username: "admin", password: auth.ADMIN_PASSWORD, next: "/documents" })),
    );

    expect(path).toBe("/documents");
    const [name, token, options] = jar.set.mock.calls[0] as [string, string, object];
    expect(name).toBe(SESSION_COOKIE);
    expect(verifySessionToken(auth.SESSION_SECRET, token)).toBe(true);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
  });

  it("never redirects off the site", async () => {
    const path = await redirectOf(
      login({}, form({ username: "admin", password: auth.ADMIN_PASSWORD, next: "//evil.example" })),
    );

    expect(path).toBe("/");
  });

  it("returns one error for any wrong credential and keeps the username", async () => {
    const wrongPassword = await login({}, form({ username: "admin", password: "nope" }));
    const wrongUser = await login({}, form({ username: "root", password: auth.ADMIN_PASSWORD }));
    const empty = await login({}, new FormData());

    expect(wrongPassword).toEqual({ error: "Incorrect username or password", username: "admin" });
    expect(wrongUser.error).toBe(wrongPassword.error);
    expect(empty).toEqual({ error: "Incorrect username or password", username: "" });
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("clears the session and returns to login", async () => {
    expect(await redirectOf(logout())).toBe("/login");
    expect(jar.delete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});
