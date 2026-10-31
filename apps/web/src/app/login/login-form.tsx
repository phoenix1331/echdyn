"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const field =
  "block w-full rounded-md border border-line bg-surface px-3 py-2.5 text-ink outline-none transition-colors focus:border-quarry focus:ring-2 focus:ring-highlight dark:focus:border-ink";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Username
        <input
          name="username"
          autoComplete="username"
          required
          defaultValue={state.username}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
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
        <p role="alert" className="rounded-md bg-brick-soft px-3 py-2 text-sm text-brick">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-quarry px-4 py-2.5 font-semibold text-on-quarry transition-[filter] hover:brightness-95 active:brightness-90 focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-stone focus-visible:outline-none disabled:opacity-60 dark:bg-ink dark:text-stone"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
