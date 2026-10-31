import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { getDocumentType } from "../document-types/registry";

export const labelSchema = z.object({
  document_type: z.string().min(1),
  /** PDF next to the label; defaults to the label's name with .pdf */
  file: z.string().min(1).optional(),
  source: z.enum(["synthetic", "real"]),
  /** Supplier template or similar, so accuracy can be broken down by layout */
  layout: z.string().min(1).optional(),
  notes: z.string().optional(),
  expected: z.record(z.string(), z.unknown()),
});

export type Label = z.infer<typeof labelSchema>;

export interface LabelledDocument {
  id: string;
  pdfPath: string;
  documentType: string;
  source: Label["source"];
  layout?: string;
  notes?: string;
  expected: Record<string, unknown>;
}

export class LabelledSetError extends Error {
  constructor(file: string, problem: string) {
    super(`${file}: ${problem}`);
    this.name = "LabelledSetError";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads every `*.json` label in a directory. Each label's expected values are checked
 * against its document type's schema, so a typo in ground truth fails loudly here
 * instead of quietly lowering measured accuracy.
 */
export async function loadLabelledSet(dir: string): Promise<LabelledDocument[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const documents: LabelledDocument[] = [];

  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch {
      throw new LabelledSetError(file, "not valid JSON");
    }

    const label = labelSchema.safeParse(raw);
    if (!label.success) {
      throw new LabelledSetError(file, z.prettifyError(label.error));
    }

    const definition = getDocumentType(label.data.document_type);
    if (!definition) {
      throw new LabelledSetError(file, `unknown document type "${label.data.document_type}"`);
    }

    const expected = definition.schema.safeParse(label.data.expected);
    if (!expected.success) {
      throw new LabelledSetError(
        file,
        `expected values do not match the schema:\n${z.prettifyError(expected.error)}`,
      );
    }

    const id = basename(file, ".json");
    const pdfPath = join(dir, label.data.file ?? `${id}.pdf`);
    if (!(await exists(pdfPath))) {
      throw new LabelledSetError(file, `missing PDF ${basename(pdfPath)}`);
    }

    documents.push({
      id,
      pdfPath,
      documentType: label.data.document_type,
      source: label.data.source,
      ...(label.data.layout === undefined ? {} : { layout: label.data.layout }),
      ...(label.data.notes === undefined ? {} : { notes: label.data.notes }),
      expected: label.data.expected,
    });
  }

  return documents;
}

export interface ReviewedLabel {
  documentType: string;
  /** SHA-256 of the PDF: names the files, so labelling the same document again overwrites it */
  sha256: string;
  filename: string;
  pdf: Uint8Array;
  expected: Record<string, unknown>;
  reviewer: string;
  reviewedAt?: Date;
}

/**
 * Adds a human-approved document to a labelled set: the PDF plus a label whose expected
 * values are the approved record. Returns the label's id (its file name without `.json`).
 */
export async function appendToLabelledSet(dir: string, input: ReviewedLabel): Promise<string> {
  const id = `reviewed-${input.sha256.slice(0, 12)}`;
  const reviewedAt = (input.reviewedAt ?? new Date()).toISOString().slice(0, 10);
  const label: Label = {
    document_type: input.documentType,
    source: "real",
    notes: `${input.filename}, reviewed by ${input.reviewer} on ${reviewedAt}`,
    expected: input.expected,
  };

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.pdf`), input.pdf);
  await writeFile(join(dir, `${id}.json`), `${JSON.stringify(label, null, 2)}\n`);
  return id;
}
