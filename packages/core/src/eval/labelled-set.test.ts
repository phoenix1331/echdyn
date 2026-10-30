import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { energyBill } from "../document-types/energy-bill";
import { validateExtraction } from "../validation/validate";
import { LabelledSetError, loadLabelledSet } from "./labelled-set";

const expected = {
  supplier: "Northern Power Ltd",
  account_number: "AC-1029384",
  meter_point_number: "1200023456781",
  billing_period_start: "2026-08-01",
  billing_period_end: "2026-08-31",
  consumption_kwh: 1250,
  unit_rate_pence: 24.5,
  standing_charge_pence_per_day: 52.1,
  subtotal_gbp: 322.4,
  vat_rate_percent: 20,
  vat_gbp: 64.48,
  total_gbp: 386.88,
};

describe("loadLabelledSet", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "echdyn-labels-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function label(name: string, body: unknown, pdf: string | null = `${name}.pdf`) {
    await writeFile(
      join(dir, `${name}.json`),
      typeof body === "string" ? body : JSON.stringify(body),
    );
    if (pdf) {
      await writeFile(join(dir, pdf), "%PDF-1.7");
    }
  }

  const valid = { document_type: "uk-energy-bill", source: "real", expected };

  it("loads labels in name order, resolving the PDF beside each", async () => {
    await label("b", valid);
    await label("a", { ...valid, layout: "Octopus", notes: "scanned at an angle" });

    const docs = await loadLabelledSet(dir);

    expect(docs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(docs[0]).toEqual({
      id: "a",
      pdfPath: join(dir, "a.pdf"),
      documentType: "uk-energy-bill",
      source: "real",
      layout: "Octopus",
      notes: "scanned at an angle",
      expected,
    });
    expect(docs[1]).not.toHaveProperty("notes");
    expect(docs[1]).not.toHaveProperty("layout");
  });

  it("honours an explicit file name", async () => {
    await label("march", { ...valid, file: "March 2026 bill.pdf" }, "March 2026 bill.pdf");

    expect((await loadLabelledSet(dir))[0]?.pdfPath).toBe(join(dir, "March 2026 bill.pdf"));
  });

  it.each([
    ["broken JSON", "{ nope", /not valid JSON/],
    ["a bad label shape", { ...valid, source: "scraped" }, /source/],
    ["an unknown document type", { ...valid, document_type: "invoice" }, /unknown document type/],
    [
      "expected values that break the schema",
      { ...valid, expected: { ...expected, billing_period_end: "31/08/2026" } },
      /billing_period_end/,
    ],
  ])("rejects %s", async (_, body, message) => {
    await label("bad", body);

    const error = await loadLabelledSet(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LabelledSetError);
    expect(String(error)).toMatch(/^LabelledSetError: bad\.json: /);
    expect(String(error)).toMatch(message);
  });

  it("rejects a label whose PDF is missing", async () => {
    await label("lonely", valid, null);

    await expect(loadLabelledSet(dir)).rejects.toThrow("lonely.json: missing PDF lonely.pdf");
  });
});

describe("committed synthetic set", () => {
  it("loads, and every label passes the business rules", async () => {
    const docs = await loadLabelledSet(
      resolve(import.meta.dirname, "../../../../eval/sets/synthetic"),
    );

    expect(docs).toHaveLength(30);
    for (const doc of docs) {
      expect(validateExtraction(energyBill, doc.expected).errors, doc.id).toEqual([]);
    }
  });
});
