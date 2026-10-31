import type { Metadata } from "next";
import { Suspense } from "react";
import { RecordAudit, RecordAuditSkeleton } from "@/components/records/record-audit";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Record - echdyn" };

export default function RecordPage({ params }: PageProps<"/records/[id]">) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Suspense fallback={<RecordAuditSkeleton />}>
          <RecordAudit params={params} />
        </Suspense>
      </main>
    </>
  );
}
