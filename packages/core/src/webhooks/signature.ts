import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "Echdyn-Signature";
/** Receivers should refuse signatures older than this, so a captured request cannot be replayed */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret)
    .update(`${String(timestamp)}.${body}`)
    .digest("hex");
}

/**
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`: the timestamp is signed with the body,
 * so neither can be changed, and a receiver can reject stale requests.
 */
export function signWebhook(secret: string, body: string, now = Date.now()): string {
  const timestamp = Math.floor(now / 1000);
  return `t=${String(timestamp)},v1=${hmac(secret, timestamp, body)}`;
}

/**
 * What a receiver runs on the raw request body (before parsing it as JSON): true only for a
 * signature made with this secret over exactly this body within the tolerance.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  body: string,
  { now = Date.now(), toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS } = {},
): boolean {
  let timestamp = Number.NaN;
  let signature = "";
  for (const part of (header ?? "").split(",")) {
    const [key, value = ""] = part.trim().split("=", 2);
    if (key === "t") {
      timestamp = Number(value);
    }
    if (key === "v1") {
      signature = value;
    }
  }
  if (!Number.isInteger(timestamp) || !signature) {
    return false;
  }
  if (Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = Buffer.from(hmac(secret, timestamp, body), "hex");
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
