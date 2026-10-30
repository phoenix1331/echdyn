import type { AuthConfig } from "./config";
import { SESSION_COOKIE, safeEqual, verifySessionToken } from "./session";

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) {
      continue;
    }
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function hasValidSession(request: Request, auth: AuthConfig, now = Date.now()): boolean {
  return verifySessionToken(auth.SESSION_SECRET, cookieValue(request, SESSION_COOKIE), now);
}

export function hasValidToken(request: Request, auth: AuthConfig): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  return match?.[1] !== undefined && safeEqual(match[1], auth.API_TOKEN);
}

export function checkCredentials(auth: AuthConfig, username: string, password: string): boolean {
  // Both compared every time, so a wrong username takes as long as a wrong password
  const userMatches = safeEqual(username, auth.ADMIN_USERNAME);
  const passwordMatches = safeEqual(password, auth.ADMIN_PASSWORD);
  return userMatches && passwordMatches;
}

/** API callers send a bearer token; the UI's own requests carry the session cookie */
export function isApiAuthenticated(request: Request, auth: AuthConfig, now = Date.now()): boolean {
  return hasValidToken(request, auth) || hasValidSession(request, auth, now);
}

export function unauthenticated(): Response {
  return Response.json(
    {
      error: {
        code: "unauthenticated",
        message: "Sign in, or send an Authorization: Bearer header with the API token",
      },
    },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="echdyn"' } },
  );
}

/**
 * Route handlers call this as well as the proxy checking first: the proxy is a single
 * point of failure, so each handler authorises itself close to the data.
 */
export function requireApiAuth(request: Request, auth: AuthConfig): Response | null {
  return isApiAuthenticated(request, auth) ? null : unauthenticated();
}

/** Only same-site relative paths, so a crafted `next` cannot send the admin to another site */
export function safeRedirectPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || /^\/[/\\]/.test(next)) {
    return "/";
  }
  return next;
}
