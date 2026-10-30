import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";

const auth = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct horse battery",
  API_TOKEN: "t".repeat(32),
  SESSION_SECRET: "s".repeat(32),
};

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: () => auth }));

const { config, proxy } = await import("./proxy");

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:8000${path}`, { headers });
const sessionCookie = () => `${SESSION_COOKIE}=${createSessionToken(auth.SESSION_SECRET, "admin")}`;
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it("redirects a page request without a session to login, remembering where it was going", () => {
    const res = proxy(request("/documents?status=queued"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/documents?status=queued");
  });

  it("lets a page request with a session through", () => {
    expect(passedThrough(proxy(request("/", { cookie: sessionCookie() })))).toBe(true);
  });

  it("answers an API request without credentials with 401 JSON, not a redirect", async () => {
    const res = proxy(request("/api/documents"));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("lets API requests through with a bearer token or a session", () => {
    const bearer = { authorization: `Bearer ${auth.API_TOKEN}` };

    expect(passedThrough(proxy(request("/api/documents", bearer)))).toBe(true);
    expect(passedThrough(proxy(request("/api/documents", { cookie: sessionCookie() })))).toBe(true);
  });
});

describe("proxy matcher", () => {
  const [pattern = ""] = config.matcher;
  const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);

  it.each(["/", "/documents", "/api/documents", "/api/healthcheck", "/login/extra"])(
    "protects %s",
    (path) => {
      expect(matches(path)).toBe(true);
    },
  );

  it.each([
    "/api/health",
    "/login",
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/next.svg",
  ])("leaves %s public", (path) => {
    expect(matches(path)).toBe(false);
  });
});
