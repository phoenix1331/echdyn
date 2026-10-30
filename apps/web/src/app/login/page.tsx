import type { Metadata } from "next";
import { Suspense } from "react";
import { safeRedirectPath } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in - echdyn" };

// searchParams is request data, so it is read behind a Suspense boundary (Cache Components)
async function Form({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={safeRedirectPath(next)} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">echdyn</h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Sign in to review documents</p>
        {/* Not a fallback form: one submitted before streaming finished would lose `next` */}
        <Suspense fallback={<div className="h-56" aria-busy="true" />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
