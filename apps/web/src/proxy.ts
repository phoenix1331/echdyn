import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig, hasValidSession, isApiAuthenticated, unauthenticated } from "@/lib/auth";

/**
 * First line of defence: pages need a session, the API a session or bearer token.
 * Route handlers check again with `requireApiAuth`, so a proxy bypass still meets a lock.
 */
export function proxy(request: NextRequest): Response {
  const auth = getAuthConfig();
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return isApiAuthenticated(request, auth) ? NextResponse.next() : unauthenticated();
  }

  if (hasValidSession(request, auth)) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Public: the Docker healthcheck, the login page and static assets. Files in public/
  // (the logo on the login page) must load before anyone has signed in.
  matcher: [
    "/((?!api/health$|login$|_next/static|_next/image|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|txt|woff2?)$).*)",
  ],
};
