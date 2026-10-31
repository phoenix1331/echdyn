import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { energyBill } from "../../document-types/energy-bill";
import type { Label } from "../labelled-set";
import { createRandom } from "../random";
import { generateBill } from "./bill";
import { layouts } from "./layouts";
import { renderPdf } from "./render";
import { withCoverLetter } from "./mixed";
import { scanPdf } from "./scan";

export interface GenerateOptions {
  count: number;
  seed: number;
  outDir: string;
  /** Also write each bill as an image-only scan here, with the same labels */
  scannedDir?: string;
  /** Also write each bill as a typed cover letter plus the scanned bill here */
  mixedDir?: string;
}

export interface GeneratedBill {
  id: string;
  pdf: Uint8Array;
  label: Label;
}

export async function generateSyntheticBills({
  count,
  seed,
}: Omit<GenerateOptions, "outDir">): Promise<GeneratedBill[]> {
  const random = createRandom(seed);
  const bills: GeneratedBill[] = [];

  // Rotate layouts so every supplier is equally represented
  const schedule = Array.from({ length: Math.ceil(count / layouts.length) }, () => layouts)
    .flat()
    .slice(0, count);

  for (const [i, layout] of schedule.entries()) {
    const bill = generateBill(random, layout.supplier);
    const pages = layout.render(bill, random.chance(0.3));
    const id = `bill-${String(i + 1).padStart(3, "0")}`;

    bills.push({
      id,
      pdf: await renderPdf(pages, `${layout.supplier} ${bill.fuel} bill`),
      label: {
        document_type: energyBill.slug,
        source: "synthetic",
        layout: layout.supplier,
        notes: `${layout.supplier}, ${bill.fuel}, ${String(pages.length)} page${pages.length > 1 ? "s" : ""}`,
        expected: bill.expected,
      },
    });
  }

  return bills;
}

/** The same bills as scans: identical ground truth, no text layer, layout marked scanned */
export async function scanBills(
  bills: readonly GeneratedBill[],
  seed: number,
): Promise<GeneratedBill[]> {
  // Its own stream, so adding scans never changes the clean bills a seed produces
  const random = createRandom(seed + 1);
  const scanned: GeneratedBill[] = [];

  for (const { id, pdf, label } of bills) {
    scanned.push({
      id,
      pdf: await scanPdf(pdf, random),
      label: {
        ...label,
        layout: `${label.layout ?? label.source} (scanned)`,
        notes: `${label.notes ?? id}, scanned`,
      },
    });
  }

  return scanned;
}

/**
 * The same bills behind a typed cover letter: a mixed document whose figures are all on the
 * scanned page, which reading per document used to miss entirely
 */
export async function mixBills(
  bills: readonly GeneratedBill[],
  seed: number,
): Promise<GeneratedBill[]> {
  // Its own stream again, so neither the clean nor the scanned set changes
  const random = createRandom(seed + 2);
  const mixed: GeneratedBill[] = [];

  for (const { id, pdf, label } of bills) {
    const supplier = label.layout ?? label.source;
    mixed.push({
      id,
      pdf: await withCoverLetter(await scanPdf(pdf, random), supplier),
      label: {
        ...label,
        layout: `${supplier} (mixed)`,
        notes: `${label.notes ?? id}, typed cover letter then scanned bill`,
      },
    });
  }

  return mixed;
}

async function writeSet(dir: string, bills: readonly GeneratedBill[]): Promise<void> {
  await mkdir(dir, { recursive: true });

  for (const { id, pdf, label } of bills) {
    await writeFile(join(dir, `${id}.pdf`), pdf);
    await writeFile(join(dir, `${id}.json`), `${JSON.stringify(label, null, 2)}\n`);
  }
}

export async function writeSyntheticSet(options: GenerateOptions): Promise<GeneratedBill[]> {
  const bills = await generateSyntheticBills(options);
  await writeSet(options.outDir, bills);

  if (options.scannedDir) {
    await writeSet(options.scannedDir, await scanBills(bills, options.seed));
  }
  if (options.mixedDir) {
    await writeSet(options.mixedDir, await mixBills(bills, options.seed));
  }

  return bills;
}
