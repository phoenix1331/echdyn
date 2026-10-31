import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Example } from "@/components/upload/upload-form";

const manifestSchema = z.array(
  z.object({
    file: z.string().regex(/^[a-z0-9-]+\.pdf$/),
    title: z.string().min(1),
    description: z.string().min(1),
  }),
);

/** The repository's examples/ folder; `next dev` runs in apps/web */
export function examplesDir(): string {
  return process.env.EXAMPLES_DIR ?? resolve(process.cwd(), "../../examples");
}

/** The examples listed in examples.json, or none when the folder is missing or invalid */
export async function loadExamples(dir = examplesDir()): Promise<Example[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dir, "examples.json"), "utf8"));
    const parsed = manifestSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** A listed example's bytes; null for anything not in the manifest, so no path is ever trusted */
export async function readExample(
  name: string,
  dir = examplesDir(),
): Promise<Uint8Array<ArrayBuffer> | null> {
  const listed = (await loadExamples(dir)).some((example) => example.file === name);
  if (!listed) {
    return null;
  }
  try {
    return new Uint8Array(await readFile(join(dir, name)));
  } catch {
    return null;
  }
}
