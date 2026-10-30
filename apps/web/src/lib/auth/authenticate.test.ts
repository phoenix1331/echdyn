import { describe, expect, it } from "vitest";
import {
  checkCredentials,
  hasValidSession,
  hasValidToken,
  isApiAuthenticated,
  requireApiAuth,
  safeRedirectPath,
  unauthenticated,
} from "./authenticate";
import { createSessionToken, SESSION_COOKIE } from "./session";

const auth = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct horse battery",
  API_TOKEN: "t".repeat(32),
  SESSION_SECRET: "s".repeat(32),
};

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/documents", { headers });
const session = () => createSessionToken(auth.SESSION_SECRET, "admin");

describe("hasValidSession", () => {
  it("accepts a signed session cookie among others", () => {
    const cookie = `theme=dark; ${SESSION_COOKIE}=${session()}; other=1`;

    expect(hasValidSession(request({ cookie }), auth)).toBe(true);
  });

  it.each([
    ["no cookies", {}],
    ["other cookies only", { cookie: "theme=dark" }],
    ["a forged session", { cookie: `${SESSION_COOKIE}=abc.def` }],
    ["a malformed escape", { cookie: `${SESSION_COOKIE}=%E0%A4%A` }],
  ])("rejects %s", (_, headers) => {
    expect(hasValidSession(request(headers), auth)).toBe(false);
  });
});

describe("hasValidToken", () => {
  it("accepts the API token as a bearer credential, any case scheme", () => {
    expect(hasValidToken(request({ authorization: `Bearer ${auth.API_TOKEN}` }), auth)).toBe(true);
    expect(hasValidToken(request({ authorization: `bearer ${auth.API_TOKEN}` }), auth)).toBe(true);
  });

  it.each([
    ["no header", {}],
    ["a wrong token", { authorization: "Bearer nope" }],
    ["basic auth", { authorization: `Basic ${auth.API_TOKEN}` }],
  ])("rejects %s", (_, headers) => {
    expect(hasValidToken(request(headers), auth)).toBe(false);
  });
});

describe("isApiAuthenticated", () => {
  it("accepts a token or a session", () => {
    expect(isApiAuthenticated(request({ authorization: `Bearer ${auth.API_TOKEN}` }), auth)).toBe(
      true,
    );
    expect(isApiAuthenticated(request({ cookie: `${SESSION_COOKIE}=${session()}` }), auth)).toBe(
      true,
    );
    expect(isApiAuthenticated(request(), auth)).toBe(false);
  });
});

describe("checkCredentials", () => {
  it.each([
    ["admin", "correct horse battery", true],
    ["admin", "wrong", false],
    ["root", "correct horse battery", false],
    ["", "", false],
  ])("%s / %s is %s", (username, password, expected) => {
    expect(checkCredentials(auth, username, password)).toBe(expected);
  });
});

describe("unauthenticated", () => {
  it("is a 401 in the API error shape with a bearer challenge", async () => {
    const res = unauthenticated();

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="echdyn"');
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });
});

describe("requireApiAuth", () => {
  it("returns nothing for an authenticated request and a 401 otherwise", () => {
    expect(requireApiAuth(request({ authorization: `Bearer ${auth.API_TOKEN}` }), auth)).toBeNull();
    expect(requireApiAuth(request(), auth)?.status).toBe(401);
  });
});

describe("safeRedirectPath", () => {
  it.each([
    ["/documents?status=queued", "/documents?status=queued"],
    ["/", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["documents", "/"],
    [undefined, "/"],
    [null, "/"],
  ])("%s -> %s", (next, expected) => {
    expect(safeRedirectPath(next)).toBe(expected);
  });
});
