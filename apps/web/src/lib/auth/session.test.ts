import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSessionToken, safeEqual, SESSION_TTL_SECONDS, verifySessionToken } from "./session";

const secret = "s".repeat(32);
const now = Date.UTC(2026, 9, 30, 12);

describe("safeEqual", () => {
  it.each([
    ["abc", "abc", true],
    ["abc", "abd", false],
    ["abc", "abcd", false],
    ["", "", true],
  ])("%s vs %s is %s", (a, b, expected) => {
    expect(safeEqual(a, b)).toBe(expected);
  });
});

describe("session tokens", () => {
  const token = createSessionToken(secret, "admin", now);

  it("verifies a token it signed", () => {
    expect(verifySessionToken(secret, token, now)).toBe(true);
  });

  it("expires after the session lifetime", () => {
    const later = now + SESSION_TTL_SECONDS * 1000;

    expect(verifySessionToken(secret, token, later - 1000)).toBe(true);
    expect(verifySessionToken(secret, token, later)).toBe(false);
  });

  it("rejects a token signed with another secret", () => {
    expect(verifySessionToken("o".repeat(32), token, now)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", exp: 9_999_999_999 })).toString(
      "base64url",
    );

    expect(verifySessionToken(secret, `${forged}.${signature}`, now)).toBe(false);
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["no signature", "abc"],
    ["extra segments", `${token}.extra`],
  ])("rejects %s", (_, value) => {
    expect(verifySessionToken(secret, value, now)).toBe(false);
  });

  it.each([
    ["a payload that is not JSON", Buffer.from("not json").toString("base64url")],
    ["a payload without an expiry", Buffer.from('{"sub":"admin"}').toString("base64url")],
  ])("rejects a correctly signed token with %s", (_, payload) => {
    // Signed with the real secret, so only the payload check can reject it
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");

    expect(verifySessionToken(secret, `${payload}.${signature}`, now)).toBe(false);
  });
});
