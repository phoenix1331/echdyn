import { describe, expect, it } from "vitest";
import { normalisePrinted, parsePrintedDate, parsePrintedNumber, toPrintedSchema } from "./printed";

const schema = {
  type: "object",
  properties: {
    supplier: { type: "string", description: "Supplier" },
    days: { type: "integer" },
    unit_rate_pence: { type: "number", exclusiveMinimum: 0, description: "Rate in pence" },
    total_gbp: { type: "number", minimum: 0, description: "Total in pounds" },
    period_start: { type: "string", format: "date", description: "First day" },
  },
  required: ["supplier", "days", "unit_rate_pence", "total_gbp", "period_start"],
};

describe("toPrintedSchema", () => {
  const printed = toPrintedSchema(schema);

  it("turns numeric fields into strings copied as printed, keeping their description", () => {
    expect(printed.properties).toMatchObject({
      unit_rate_pence: {
        type: "string",
        description: expect.stringMatching(
          /^Rate in pence\. Copy it exactly as printed/,
        ) as unknown,
      },
      days: { type: "string", description: expect.stringMatching(/^Copy it exactly/) as unknown },
    });
    expect(printed.properties).not.toHaveProperty("total_gbp.minimum");
  });

  it("constrains printed numbers to a currency, one number and trailing units", () => {
    const { pattern } = (printed.properties as Record<string, { pattern: string }>).total_gbp ?? {
      pattern: "",
    };
    const accepts = (text: string) => new RegExp(pattern).test(text);

    for (const text of [
      "£1,526.95",
      "GBP 386.88",
      "0.8001 GBP",
      "£0.8001 per day",
      "30.76p per kWh",
      "20%",
      "6,083",
    ]) {
      expect(accepts(text), text).toBe(true);
    }
    for (const text of ["", "Not provided-0", "Net amount 746.99", "Amount to be-2.34"]) {
      expect(accepts(text), text).toBe(false);
    }
  });

  it("leaves other fields and the rest of the schema alone", () => {
    expect(printed.properties).toHaveProperty("supplier", {
      type: "string",
      description: "Supplier",
    });
    expect(printed.required).toEqual(schema.required);
  });

  it("keeps date fields as dates by default, which Ollama's grammar forces into YYYY-MM-DD", () => {
    expect(printed.properties).toHaveProperty("period_start.format", "date");
  });

  it("can ask for dates as printed, dropping the format that forces the grammar", () => {
    const dates = toPrintedSchema(schema, { dates: true });
    const start = (dates.properties as Record<string, Record<string, unknown>>).period_start;

    expect(start).not.toHaveProperty("format");
    expect(start?.description).toMatch(/^First day\. Copy the date exactly as printed/);
    const pattern = new RegExp(String(start?.pattern));
    for (const date of ["01/08/2026", "1 August 2026", "01-Aug-26", "2026-08-01", "1st Aug 2026"]) {
      expect(pattern.test(date), date).toBe(true);
    }
    expect(pattern.test("")).toBe(false);
    expect(pattern.test("Not provided")).toBe(false);
  });

  it("copes with a schema without properties", () => {
    expect(toPrintedSchema({ type: "object" })).toEqual({ type: "object", properties: {} });
  });
});

describe("parsePrintedNumber", () => {
  it.each([
    ["£1,526.95", undefined, 1526.95],
    ["1,613.13 GBP", undefined, 1613.13],
    ["GBP 386.88", "pounds", 386.88],
    ["6,083 kWh", undefined, 6083],
    ["20%", undefined, 20],
    ["30.76p per kWh", "pence", 30.76],
    ["18.30 p/kWh", "pence", 18.3],
    ["£0.1830/kWh", "pence", 18.3],
    ["0.8001 GBP per day", "pence", 80.01],
    ["45p", "pounds", 0.45],
    ["15 pence", "pounds", 0.15],
    ["-12.50", undefined, -12.5],
    [".5", undefined, 0.5],
    // A bare rate under 1p is pounds with the £ dropped (no UK rate is that low)
    ["0.1830", "pence", 18.3],
    ["0.8001 per day", "pence", 80.01],
    ["24.50", "pence", 24.5],
    ["0.5p", "pence", 0.5],
  ] as const)("reads %s (stored in %s) as %d", (text, unit, expected) => {
    expect(parsePrintedNumber(text, unit)).toBe(expected);
  });

  it("does not mistake a word starting with p for pence", () => {
    expect(parsePrintedNumber("80.01 per day", "pounds")).toBe(80.01);
  });

  it("returns null when there is no number", () => {
    expect(parsePrintedNumber("not shown")).toBeNull();
  });
});

describe("parsePrintedDate", () => {
  it.each([
    ["2026-08-01", "2026-08-01"],
    ["01/08/2026", "2026-08-01"],
    ["1/8/2026", "2026-08-01"],
    ["01.08.2026", "2026-08-01"],
    ["01-08-26", "2026-08-01"],
    ["1 August 2026", "2026-08-01"],
    ["10 February 2026", "2026-02-10"],
    ["1st Aug 2026", "2026-08-01"],
    ["01-Aug-26", "2026-08-01"],
    ["3 sept 2026", "2026-09-03"],
    [" 28 Jun 2025 ", "2025-06-28"],
  ])("reads %s as %s", (text, expected) => {
    expect(parsePrintedDate(text)).toBe(expected);
  });

  it.each(["31/02/2026", "2026-13-01", "1 Smarch 2026", "next Tuesday", ""])(
    "returns null for %j",
    (text) => {
      expect(parsePrintedDate(text)).toBeNull();
    },
  );
});

describe("normalisePrinted", () => {
  it("parses numeric fields in their stored units and keeps the rest", () => {
    expect(
      normalisePrinted(
        schema,
        {
          supplier: "SEVERN VALLEY ENERGY",
          days: "30 days",
          unit_rate_pence: "£0.1830",
          total_gbp: "£1,935.76",
          period_start: "10 February 2026",
        },
        { unit_rate_pence: "pence" },
      ),
    ).toEqual({
      supplier: "SEVERN VALLEY ENERGY",
      days: 30,
      unit_rate_pence: 18.3,
      total_gbp: 1935.76,
      period_start: "2026-02-10",
    });
  });

  it("leaves numbers, unknown fields and unreadable text for validation to judge", () => {
    expect(
      normalisePrinted(schema, {
        total_gbp: 12,
        unit_rate_pence: "n/a",
        period_start: "sometime",
        extra: "1",
      }),
    ).toEqual({
      total_gbp: 12,
      unit_rate_pence: "n/a",
      period_start: "sometime",
      extra: "1",
    });
  });
});
