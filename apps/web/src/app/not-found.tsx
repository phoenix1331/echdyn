import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start px-4 py-16 md:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Nothing here</h1>
        <p className="mt-2 max-w-md text-muted">
          This document does not exist, or it was deleted. Check the link, or find it in the list.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-md bg-quarry px-4 py-2.5 text-sm font-semibold text-on-quarry hover:bg-quarry/90 focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none dark:bg-ink dark:text-stone"
        >
          Go to documents
        </Link>
      </main>
    </>
  );
}
