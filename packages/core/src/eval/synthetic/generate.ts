import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { energyBill } from "../../document-types/energy-bill";
import type { Label } from "../labelled-set";
import { createRandom } from "../random";
import { generateBill } from "./bill";
import { layouts } from "./layouts";
import { renderPdf } from "./render";

export interface GenerateOptions {
  count: number;
  seed: number;
  outDir: string;
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
        notes: `${layout.supplier}, ${bill.fuel}, ${String(pages.length)} page${pages.length > 1 ? "s" : ""}`,
        expected: bill.expected,
      },
    });
  }

  return bills;
}

export async function writeSyntheticSet(options: GenerateOptions): Promise<GeneratedBill[]> {
  const bills = await generateSyntheticBills(options);
  await mkdir(options.outDir, { recursive: true });

  for (const { id, pdf, label } of bills) {
    await writeFile(join(options.outDir, `${id}.pdf`), pdf);
    await writeFile(join(options.outDir, `${id}.json`), `${JSON.stringify(label, null, 2)}\n`);
  }

  return bills;
}
