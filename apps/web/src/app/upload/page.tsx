import { listDocumentTypeOptions } from "@echdyn/core";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { UploadForm } from "@/components/upload/upload-form";
import { getServices } from "@/lib/services";
import { loadExamples } from "@/lib/upload/examples";

export const metadata: Metadata = { title: "Upload - echdyn" };

async function Upload() {
  const [types, examples] = await Promise.all([
    listDocumentTypeOptions(getServices().db),
    loadExamples(),
  ]);
  return <UploadForm types={types} examples={examples} />;
}

export default function UploadPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Upload documents</h1>
        <p className="mt-1 mb-6 text-muted">
          Each file is read on this machine, checked, and sent to review if anything looks wrong.
        </p>
        <Suspense fallback={<div className="h-64 rounded-lg border border-line bg-surface" />}>
          <Upload />
        </Suspense>
      </main>
    </>
  );
}
