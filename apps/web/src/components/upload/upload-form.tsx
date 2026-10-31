"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import {
  describeEstimate,
  describePages,
  describeQueue,
  PATH_LABELS,
  warningsFor,
  type InspectResponse,
} from "@/lib/upload/summary";

export interface DocumentTypeOption {
  slug: string;
  name: string;
}

export interface Example {
  file: string;
  title: string;
  description: string;
}

interface Item {
  key: string;
  file: File;
  inspection?: InspectResponse;
  error?: string;
}

const button =
  "rounded-md px-4 py-2.5 text-sm font-semibold transition-[filter,background-color] focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:opacity-50";

const MB = 1024 * 1024;

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Upload failed (${String(response.status)})`;
  } catch {
    return `Upload failed (${String(response.status)})`;
  }
}

function form(file: File, documentType: string): FormData {
  const data = new FormData();
  data.append("document_type", documentType);
  data.append("file", file);
  return data;
}

export function UploadForm({
  types,
  examples,
}: {
  types: DocumentTypeOption[];
  examples: Example[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState(types[0]?.slug ?? "");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<"inspecting" | "uploading" | null>(null);
  const [dragging, setDragging] = useState(false);
  // Numbers each batch, so a file picked twice still gets a fresh key
  const batch = useRef(0);

  async function inspect(files: File[]) {
    if (files.length === 0) {
      return;
    }
    setBusy("inspecting");
    batch.current += 1;
    const inspected: Item[] = [];
    for (const [i, file] of files.entries()) {
      const key = `${String(batch.current)}-${String(i)}-${file.name}`;
      const response = await fetch("/api/documents/inspect", {
        method: "POST",
        body: form(file, documentType),
      });
      inspected.push(
        response.ok
          ? { key, file, inspection: (await response.json()) as InspectResponse }
          : { key, file, error: await errorMessage(response) },
      );
    }
    setItems(inspected);
    setBusy(null);
    dialog.current?.showModal();
  }

  async function loadExample(example: Example) {
    const response = await fetch(`/examples/${example.file}`);
    const blob = await response.blob();
    await inspect([new File([blob], example.file, { type: "application/pdf" })]);
  }

  function cancel() {
    dialog.current?.close();
    setItems([]);
    if (picker.current) {
      picker.current.value = "";
    }
  }

  async function proceed() {
    setBusy("uploading");
    const results: Item[] = [];
    let failed = 0;
    for (const item of items) {
      if (item.error) {
        results.push(item);
        continue;
      }
      const response = await fetch("/api/documents", {
        method: "POST",
        body: form(item.file, documentType),
      });
      if (!response.ok) {
        failed++;
      }
      results.push(response.ok ? item : { ...item, error: await errorMessage(response) });
    }

    setBusy(null);
    // Everything went: the list shows each one with live progress
    if (failed === 0) {
      dialog.current?.close();
      router.push("/");
      return;
    }
    setItems(results);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void inspect([...event.dataTransfer.files]);
  }

  const ready = items.filter((item) => !item.error);
  const queue = items.find((item) => item.inspection)?.inspection?.queue;
  const queueLine = queue ? describeQueue(queue) : null;

  return (
    <div className="flex flex-col gap-6">
      {types.length > 1 && (
        <label className="flex max-w-sm flex-col gap-1.5 text-sm font-medium text-ink">
          Document type
          <select
            value={documentType}
            onChange={(event) => {
              setDocumentType(event.target.value);
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink focus:ring-2 focus:ring-highlight focus:outline-none"
          >
            {types.map((type) => (
              <option key={type.slug} value={type.slug}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors ${
          dragging ? "border-highlight bg-highlight-soft" : "border-line bg-surface"
        }`}
      >
        <p className="text-lg font-semibold text-ink">
          {busy === "inspecting" ? "Checking files..." : "Drop PDFs here"}
        </p>
        <p className="text-sm text-muted">
          PDF only, up to 20 MB each. You will see what each file contains before anything is
          uploaded.
        </p>
        <input
          ref={picker}
          id="upload-files"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(event) => {
            void inspect([...(event.target.files ?? [])]);
          }}
        />
        <label
          htmlFor="upload-files"
          className={`${button} cursor-pointer bg-highlight text-on-highlight hover:brightness-110`}
        >
          Choose files
        </label>
      </div>

      {examples.length > 0 && (
        <section aria-labelledby="examples-heading" className="flex flex-col gap-3">
          <div>
            <h2 id="examples-heading" className="font-semibold text-ink">
              No bill to hand? Try an example
            </h2>
            <p className="text-sm text-muted">
              Synthetic UK energy bills, each testing something different.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {examples.map((example) => (
              <li
                key={example.file}
                className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
              >
                <p className="font-medium text-ink">{example.title}</p>
                <p className="flex-1 text-sm text-muted">{example.description}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      void loadExample(example);
                    }}
                    className={`${button} border border-line bg-surface text-ink hover:border-muted hover:bg-stone`}
                  >
                    Use this example
                  </button>
                  <a
                    href={`/examples/${example.file}`}
                    download
                    className={`${button} text-muted hover:bg-stone hover:text-ink`}
                  >
                    Download
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dialog
        ref={dialog}
        aria-labelledby="summary-heading"
        onCancel={(event) => {
          event.preventDefault();
          cancel();
        }}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="border-b border-line px-5 py-4">
            <h2 id="summary-heading" className="text-lg font-semibold">
              Before you upload
            </h2>
            <p className="text-sm text-muted">
              Nothing has been stored yet. Check what each file contains, then upload.
            </p>
          </div>

          <ul className="flex-1 divide-y divide-line overflow-y-auto">
            {items.map((item) => (
              <li key={item.key} className="px-5 py-4" data-file={item.file.name}>
                <div className="flex items-baseline justify-between gap-4">
                  <p className="min-w-0 truncate font-medium" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p className="shrink-0 text-sm text-muted">
                    {(item.file.size / MB).toFixed(1)} MB
                  </p>
                </div>
                {item.inspection && (
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted">Contains</dt>
                    <dd>{describePages(item.inspection.page_kinds)}</dd>
                    <dt className="text-muted">How</dt>
                    <dd>{PATH_LABELS[item.inspection.path]}</dd>
                    <dt className="text-muted">Time</dt>
                    <dd>{describeEstimate(item.inspection)}</dd>
                  </dl>
                )}
                {item.inspection &&
                  warningsFor(item.inspection).map((warning) => (
                    <p
                      key={warning.message}
                      className="mt-2 rounded-md bg-highlight-soft px-3 py-2 text-sm text-highlight-ink"
                    >
                      {warning.message}{" "}
                      {warning.href && (
                        <a href={warning.href} className="font-medium underline underline-offset-2">
                          Open it
                        </a>
                      )}
                    </p>
                  ))}
                {item.error && (
                  <p
                    role="alert"
                    className="mt-2 rounded-md bg-brick-soft px-3 py-2 text-sm text-brick"
                  >
                    {item.error}. This file will be skipped.
                  </p>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">{queueLine ?? "Nothing else is waiting."}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={busy === "uploading"}
                className={`${button} text-muted hover:bg-stone hover:text-ink`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void proceed();
                }}
                disabled={ready.length === 0 || busy !== null}
                className={`${button} bg-highlight text-on-highlight hover:brightness-110`}
              >
                {busy === "uploading"
                  ? "Uploading..."
                  : `Upload ${ready.length === 1 ? "1 file" : `${String(ready.length)} files`}`}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
