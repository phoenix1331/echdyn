import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhookSignature } from "./signature";

const secret = "whsec_test";
const body = '{"type":"record.approved"}';
const now = Date.UTC(2026, 9, 31, 12);

describe("webhook signatures", () => {
  it("signs the timestamp with the body and verifies its own signature", () => {
    const header = signWebhook(secret, body, now);

    expect(header).toMatch(/^t=1793448000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, header, body, { now })).toBe(true);
  });

  it("is the same for the same input, so receivers can recompute it", () => {
    expect(signWebhook(secret, body, now)).toBe(signWebhook(secret, body, now + 999));
  });

  it("rejects a changed body, a different secret or a moved timestamp", () => {
    const header = signWebhook(secret, body, now);

    expect(verifyWebhookSignature(secret, header, `${body} `, { now })).toBe(false);
    expect(verifyWebhookSignature("whsec_other", header, body, { now })).toBe(false);
    expect(
      verifyWebhookSignature(secret, header.replace("t=1793448000", "t=1793448001"), body, {
        now,
      }),
    ).toBe(false);
  });

  it("rejects replays older than the tolerance", () => {
    const header = signWebhook(secret, body, now);

    expect(verifyWebhookSignature(secret, header, body, { now: now + 299_000 })).toBe(true);
    expect(verifyWebhookSignature(secret, header, body, { now: now + 301_000 })).toBe(false);
    expect(
      verifyWebhookSignature(secret, header, body, {
        now: now + 3_600_000,
        toleranceSeconds: 7200,
      }),
    ).toBe(true);
  });

  it.each([null, undefined, "", "t=abc,v1=00", "v1=00", "t=1793448000", "t=1793448000,v1=zz"])(
    "rejects a malformed header %j",
    (header) => {
      expect(verifyWebhookSignature(secret, header, body, { now })).toBe(false);
    },
  );
});
