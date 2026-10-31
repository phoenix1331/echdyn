import { cookies } from "next/headers";
import { getAuthConfig } from "./config";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/**
 * The signed-in admin's name, or null without a valid session. Server actions call this
 * themselves rather than trusting the proxy alone, as route handlers do.
 */
export async function currentReviewer(now = Date.now()): Promise<string | null> {
  const auth = getAuthConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(auth.SESSION_SECRET, token, now) ? auth.ADMIN_USERNAME : null;
}
