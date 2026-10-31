import type { Metadata } from "next";
import { Suspense } from "react";
import { RecordList, RecordListSkeleton } from "@/components/records/record-list";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Records - echdyn" };

export default function RecordsPage({ searchParams }: PageProps<"/records">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-10">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight text-ink">Records</h1>
        <Suspense fallback={<RecordListSkeleton />}>
          <RecordList searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}
