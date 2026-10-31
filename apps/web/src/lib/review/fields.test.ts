import type { DocumentReview, FieldError, ReviewRun } from "@echdyn/core";
import { describe, expect, it } from "vitest";
import { buildReview, formatValue, humanise } from "./fields";

const schema = {
  type: "object",
  properties: {
    supplier: { type: "string", description: "Energy supplier name" },
    billing_period_end: { type: "string", format: "date" },
    unit_rate_pence: { type: "number" },
    subtotal_gbp: { type: "number" },
    total_gbp: { type: "number" },
  },
};

const display = {
  supplier: { label: "Supplier" },
  unit_rate_pence: { label: "Unit rate", unit: "p/kWh" },
  subtotal_gbp: { label: "Subtotal", currency: true },
  total_gbp: { label: "Total", currency: true },
};

const run = (
  runNumber: number,
  parsed: Record<string, unknown> | null,
  printed = parsed,
): ReviewRun => ({
  runNumber,
  model: "llama3.2",
  promptVersion: "text-v2",
  parsed,
  printed,
  validationErrors: [],
  durationMs: 1000,
  createdAt: new Date(Date.UTC(2026, 9, 30, 9)),
});

const review = (
  flags: FieldError[],
  runs: ReviewRun[],
  approval: Pick<DocumentReview, "record" | "corrections"> = { record: null, corrections: [] },
): DocumentReview =>
  ({
    document: { flags },
    schema,
    runs,
    ...approval,
  }) as unknown as DocumentReview;

const values = {
  supplier: "Severn Valley Energy",
  billing_period_end: "2026-03-13",
  unit_rate_pence: 18.3,
  subtotal_gbp: 721.39,
  total_gbp: 784.34,
};

describe("humanise", () => {
  it.each([
    ["standing_charge_pence_per_day", "Standing charge pence per day"],
    ["vat_gbp", "VAT gbp"],
    ["consumption_kwh", "Consumption kWh"],
    ["", ""],
  ])("%s reads %s", (key, expected) => {
    expect(humanise(key)).toBe(expected);
  });
});

describe("formatValue", () => {
  it.each([
    [1526.95, { label: "", currency: true }, undefined, "£1,526.95"],
    [6083, { label: "", unit: "kWh" }, undefined, "6,083 kWh"],
    [18.3, { label: "", unit: "p/kWh" }, undefined, "18.3 p/kWh"],
    [20, { label: "", unit: "%" }, undefined, "20%"],
    [0.12345, undefined, undefined, "0.1235"],
    ["2026-03-13", undefined, "date", "13 Mar 2026"],
    ["13/03/2026", undefined, "date", "13/03/2026"],
    ["AC-7555673", undefined, undefined, "AC-7555673"],
    [null, undefined, undefined, ""],
    ["", undefined, undefined, ""],
    [true, undefined, undefined, "true"],
  ])("%j reads %s", (value, fieldDisplay, format, expected) => {
    expect(formatValue(value, fieldDisplay, format)).toBe(expected);
  });
});

describe("buildReview", () => {
  it("lists fields in the definition's order, formatted, with nothing flagged", () => {
    const view = buildReview(review([], [run(1, values), run(2, values)]), display, [
      "total_gbp",
      "supplier",
    ]);

    expect(view.fields.map((f) => [f.label, f.value])).toEqual([
      ["Total", "£784.34"],
      ["Supplier", "Severn Valley Energy"],
      ["Billing period end", "13 Mar 2026"],
      ["Unit rate", "18.3 p/kWh"],
      ["Subtotal", "£721.39"],
    ]);
    expect(view.fields[1]?.description).toBe("Energy supplier name");
    expect(view.fields.every((f) => f.issues.length === 0 && !f.printed)).toBe(true);
    expect(view).toMatchObject({ checks: [], general: [], runCount: 2 });
  });

  it("merges the same check from both runs and summarises it once across its fields", () => {
    const message = "Subtotal + VAT = £805.74, but total is £784.34";
    const flags = [1, 2].flatMap((n) =>
      ["subtotal_gbp", "total_gbp"].map((field) => ({
        field,
        rule: "total-adds-up",
        message: `Run ${String(n)}: ${message}`,
      })),
    );

    const view = buildReview(review(flags, [run(1, values), run(2, values)]), display);

    const subtotal = view.fields.find((f) => f.key === "subtotal_gbp");
    expect(subtotal?.issues).toEqual([{ kind: "check", message, runs: [1, 2] }]);
    expect(view.checks).toEqual([{ message, fields: ["Subtotal", "Total"], runs: [1, 2] }]);
  });

  it("shows what the other run read, and the printed text, for a disagreement", () => {
    const flags = [
      { field: "unit_rate_pence", rule: "run-mismatch", message: "Runs disagree: 18.3 vs 0.183" },
      { field: "unit_rate_pence", rule: "subtotal-arithmetic", message: "Run 2: does not add up" },
    ];
    const runs = [
      run(1, values, { ...values, unit_rate_pence: "£0.1830/kWh" }),
      run(2, { ...values, unit_rate_pence: 0.183 }),
    ];

    const field = buildReview(review(flags, runs), display).fields.find(
      (f) => f.key === "unit_rate_pence",
    );

    expect(field).toMatchObject({
      value: "18.3 p/kWh",
      printed: "£0.1830/kWh",
      issues: [
        { kind: "mismatch", message: "The runs disagree: run 2 read 0.183 p/kWh", runs: [] },
        { kind: "check", message: "does not add up", runs: [2] },
      ],
    });
  });

  it("says when another run found nothing", () => {
    const flags = [{ field: "supplier", rule: "run-mismatch", message: "Runs disagree" }];
    const runs = [run(1, values), run(2, { ...values, supplier: null })];

    const [supplier] = buildReview(review(flags, runs), display).fields;

    expect(supplier.issues[0]?.message).toBe("The runs disagree: run 2 read nothing");
  });

  it("keeps schema errors as format issues and whole-run problems as general notes", () => {
    const flags = [
      { field: "total_gbp", message: "Run 1: Invalid input: expected number, received string" },
      { field: "_root", message: "Run 2: Model output is not valid JSON" },
      { field: "_root", message: "Run 3: Model output is not valid JSON" },
    ];
    const runs = [run(1, { ...values, total_gbp: "n/a" }), run(2, null), run(3, null)];

    const view = buildReview(review(flags, runs), display);

    expect(view.fields.find((f) => f.key === "total_gbp")?.issues).toEqual([
      { kind: "format", message: "Invalid input: expected number, received string", runs: [1] },
    ]);
    expect(view.general).toEqual(["Model output is not valid JSON"]);
    expect(view.checks).toEqual([]);
  });

  it("copes with no runs yet and a schema without properties", () => {
    expect(buildReview(review([], []), display).fields.every((f) => f.value === "")).toBe(true);
    expect(buildReview({ ...review([], []), schema: {} }).fields).toEqual([]);
  });

  it("gives each field its raw value and input type for correcting", () => {
    const view = buildReview(review([], [run(1, { ...values, supplier: null })]), display);
    const input = Object.fromEntries(view.fields.map((f) => [f.key, f.input]));

    expect(input).toEqual({
      supplier: { value: "", type: "text" },
      billing_period_end: { value: "2026-03-13", type: "date" },
      unit_rate_pence: { value: "18.3", type: "number", unit: "p/kWh" },
      subtotal_gbp: { value: "721.39", type: "number", unit: "£" },
      total_gbp: { value: "784.34", type: "number", unit: "£" },
    });
  });

  it("shows an approved document's record, who corrected what, and no open flags", () => {
    const flags = [{ field: "total_gbp", rule: "total-adds-up", message: "Run 1: Total is off" }];
    const view = buildReview(
      review(flags, [run(1, values)], {
        record: {
          id: "r1",
          data: { ...values, total_gbp: 805.74 },
          approvedBy: "admin",
          approvedAt: new Date(),
        },
        corrections: [
          {
            field: "total_gbp",
            oldValue: 784.34,
            newValue: 805.74,
            reviewer: "admin",
            createdAt: new Date(),
          },
          {
            field: "supplier",
            oldValue: null,
            newValue: "x",
            reviewer: "admin",
            createdAt: new Date(),
          },
        ],
      }),
      display,
    );
    const total = view.fields.find((f) => f.key === "total_gbp");

    expect(view.approvedBy).toBe("admin");
    expect(total).toMatchObject({ value: "£805.74", corrected: { from: "£784.34", by: "admin" } });
    expect(view.fields.find((f) => f.key === "supplier")?.corrected?.from).toBe("nothing");
    expect(view.fields.every((f) => f.issues.length === 0)).toBe(true);
    expect(view.checks).toEqual([]);
  });

  it("leaves approvedBy unset and ignores corrections until there is a record", () => {
    const view = buildReview(
      review([], [run(1, values)], {
        record: null,
        corrections: [
          {
            field: "total_gbp",
            oldValue: 1,
            newValue: 2,
            reviewer: "admin",
            createdAt: new Date(),
          },
        ],
      }),
      display,
    );

    expect(view.approvedBy).toBeUndefined();
    expect(view.fields.some((f) => f.corrected)).toBe(false);
  });
});
