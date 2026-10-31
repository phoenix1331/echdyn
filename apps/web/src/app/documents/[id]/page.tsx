import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewScreen, ReviewSkeleton } from "@/components/review/review-screen";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Review - echdyn" };

export default function ReviewPage({ params, searchParams }: PageProps<"/documents/[id]">) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Suspense fallback={<ReviewSkeleton />}>
          <ReviewScreen params={params} searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}
