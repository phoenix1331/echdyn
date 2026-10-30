"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkCredentials,
  createSessionToken,
  getAuthConfig,
  safeRedirectPath,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export interface LoginState {
  error?: string;
  username?: string;
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const auth = getAuthConfig();
  const username = text(form, "username");
  const password = text(form, "password");

  if (!checkCredentials(auth, username, password)) {
    // One message for both cases, so the form does not confirm which username exists
    return { error: "Incorrect username or password", username };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken(auth.SESSION_SECRET, username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect(safeRedirectPath(form.get("next")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
