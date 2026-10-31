import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "../../pipeline/stages/pre-process";
import { loadLabelledSet } from "../labelled-set";
import { createRandom } from "../random";
import { generateSyntheticBills, scanBills, writeSyntheticSet } from "./generate";
import { scanPdf } from "./scan";

describe("scanPdf", () => {
  it("keeps every page and its size but drops the text layer", async () => {
    const [bill] = await generateSyntheticBills({ count: 1, seed: 7 });
    const original = await PDFDocument.load(bill?.pdf ?? new Uint8Array());

    const scanned = await scanPdf(bill?.pdf ?? new Uint8Array(), createRandom(1));

    const copy = await PDFDocument.load(scanned);
    expect(copy.getPageCount()).toBe(original.getPageCount());
    expect(copy.getPage(0).getSize()).toEqual(original.getPage(0).getSize());
    expect((await extractPdfText(bill?.pdf ?? new Uint8Array())).hasTextLayer).toBe(true);
    expect((await extractPdfText(scanned)).hasTextLayer).toBe(false);
  });

  it("is repeatable for a seed", async () => {
    const [bill] = await generateSyntheticBills({ count: 1, seed: 7 });
    const pdf = bill?.pdf ?? new Uint8Array();

    const first = await scanPdf(pdf, createRandom(3));
    const second = await scanPdf(pdf, createRandom(3));

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});

describe("scanned set", () => {
  it("keeps the labels' ground truth and marks the layout as scanned", async () => {
    const bills = await generateSyntheticBills({ count: 2, seed: 7 });

    const scanned = await scanBills(bills, 7);

    expect(scanned.map((b) => b.id)).toEqual(bills.map((b) => b.id));
    expect(scanned[0]?.label.expected).toEqual(bills[0]?.label.expected);
    expect(scanned[0]?.label.layout).toBe(`${bills[0]?.label.layout ?? ""} (scanned)`);
    expect(scanned[0]?.label.notes).toMatch(/, scanned$/);
  });

  it("writes loadable clean and scanned sets side by side", async () => {
    const root = await mkdtemp(join(tmpdir(), "echdyn-scanned-"));
    try {
      await writeSyntheticSet({
        count: 2,
        seed: 7,
        outDir: join(root, "synthetic"),
        scannedDir: join(root, "scanned"),
      });

      expect((await readdir(join(root, "scanned"))).sort()).toEqual([
        "bill-001.json",
        "bill-001.pdf",
        "bill-002.json",
        "bill-002.pdf",
      ]);
      const docs = await loadLabelledSet(join(root, "scanned"));
      expect(docs.map((d) => d.set)).toEqual(["scanned", "scanned"]);
      const label = JSON.parse(await readFile(join(root, "scanned", "bill-001.json"), "utf8")) as {
        layout: string;
      };
      expect(label.layout).toContain("(scanned)");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
