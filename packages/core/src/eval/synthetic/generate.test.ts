import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { extractPdfText } from "../../pipeline/stages/pre-process";
import { loadLabelledSet } from "../labelled-set";
import { generateSyntheticBills, writeSyntheticSet } from "./generate";
import { formatGbp } from "./format";

describe("generateSyntheticBills", () => {
  it("is byte-for-byte reproducible from a seed", async () => {
    const [a, b] = await Promise.all([
      generateSyntheticBills({ count: 3, seed: 9 }),
      generateSyntheticBills({ count: 3, seed: 9 }),
    ]);

    expect(a.map((bill) => Buffer.from(bill.pdf).toString("base64"))).toEqual(
      b.map((bill) => Buffer.from(bill.pdf).toString("base64")),
    );
  });

  it("rotates through every supplier layout and prints the totals", async () => {
    const bills = await generateSyntheticBills({ count: 6, seed: 3 });

    expect(new Set(bills.map((b) => b.label.expected.supplier)).size).toBe(3);

    for (const bill of bills) {
      const text = await extractPdfText(bill.pdf);
      const total = bill.label.expected.total_gbp as number;
      expect(text.hasTextLayer).toBe(true);
      expect(text.pages.join("\n")).toContain(formatGbp(total, false));
    }
  });

  it("adds a usage history page to some bills", async () => {
    const bills = await generateSyntheticBills({ count: 20, seed: 1331 });
    const pageCounts = await Promise.all(
      bills.map(async (b) => (await extractPdfText(b.pdf)).pageCount),
    );

    expect(new Set(pageCounts)).toEqual(new Set([1, 2]));
  });
});

describe("writeSyntheticSet", () => {
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("writes PDFs with labels the loader accepts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "echdyn-synthetic-"));
    dirs.push(dir);

    const written = await writeSyntheticSet({ count: 4, seed: 5, outDir: join(dir, "set") });
    const loaded = await loadLabelledSet(join(dir, "set"));

    expect(loaded.map((d) => d.id)).toEqual(["bill-001", "bill-002", "bill-003", "bill-004"]);
    expect(loaded.map((d) => d.expected)).toEqual(written.map((w) => w.label.expected));
    expect(loaded[0]).toMatchObject({ source: "synthetic", documentType: "uk-energy-bill" });
  });
});
