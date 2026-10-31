import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentList, DocumentListSkeleton } from "@/components/documents/document-list";
import { ExportLinks } from "@/components/documents/export-links";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Documents - echdyn" };

export default function DocumentsPage({ searchParams }: PageProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Documents</h1>
          <Suspense>
            <ExportLinks />
          </Suspense>
        </div>
        {/* The list reads the URL and the database per request, so it streams in behind this */}
        <Suspense fallback={<DocumentListSkeleton />}>
          <DocumentList searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}
