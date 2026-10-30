"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const field =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Username
        <input
          name="username"
          autoComplete="username"
          required
          defaultValue={state.username}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={field}
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
