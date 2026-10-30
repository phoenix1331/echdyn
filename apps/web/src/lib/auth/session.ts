import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "echdyn_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Compares two secrets in constant time. Hashing first gives equal-length buffers,
 * so the comparison leaks neither the content nor the length of the expected value.
 */
export function safeEqual(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * A stateless session: base64url JSON `{ sub, exp }` plus an HMAC signature.
 * There is one admin and no session table, so changing SESSION_SECRET signs everyone out.
 */
export function createSessionToken(secret: string, username: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ sub: username, exp })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): boolean {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 2) {
    return false;
  }
  const [payload = "", signature = ""] = parts;
  if (payload === "" || !safeEqual(signature, sign(payload, secret))) {
    return false;
  }

  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof exp === "number" && exp * 1000 > now;
  } catch {
    return false;
  }
}
