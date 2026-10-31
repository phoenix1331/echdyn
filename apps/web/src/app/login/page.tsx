import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
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
    <div className="flex flex-1 flex-col md:flex-row">
      <section className="flex flex-col justify-between gap-10 bg-quarry px-8 py-10 text-on-quarry md:w-[42%] md:px-14 md:py-14">
        <div className="self-start">
          <Logo className="h-10 w-auto" />
        </div>
        <div className="max-w-sm">
          <h1 className="text-3xl leading-tight font-semibold md:text-4xl">
            Bills in. Checked figures out.
          </h1>
          <p className="mt-4 leading-relaxed text-on-quarry/75">
            Every field is read by a model on this machine, checked against the bill&apos;s own
            arithmetic, and marked for you when something does not add up.
          </p>
        </div>
        <p className="hidden text-sm text-on-quarry/60 md:block">Nothing leaves your hardware.</p>
      </section>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[22.5rem]">
          <h2 className="text-2xl font-semibold text-ink">Sign in</h2>
          <p className="mt-1 mb-8 text-muted">Use the admin account from your settings.</p>
          {/* Not a fallback form: one submitted before streaming finished would lose `next` */}
          <Suspense fallback={<div className="h-64" aria-busy="true" />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
