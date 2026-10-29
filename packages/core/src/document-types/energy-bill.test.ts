import { describe, expect, it } from "vitest";
import { energyBillRules, energyBillSchema, isValidMpanCore, type EnergyBill } from "./energy-bill";

const validBill: EnergyBill = {
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

describe("energyBillSchema", () => {
  it("accepts a well-formed bill", () => {
    expect(energyBillSchema.parse(validBill)).toEqual(validBill);
  });

  it("accepts a 6-digit gas MPRN", () => {
    expect(energyBillSchema.safeParse({ ...validBill, meter_point_number: "123456" }).success).toBe(
      true,
    );
  });

  it.each([
    ["billing_period_start", "01/08/2026"],
    ["billing_period_end", "2026-02-30"],
    ["meter_point_number", "MPAN 12"],
    ["consumption_kwh", -5],
    ["unit_rate_pence", 0],
    ["total_gbp", "386.88"],
    ["supplier", ""],
  ])("rejects an invalid %s (%s)", (field, value) => {
    const result = energyBillSchema.safeParse({ ...validBill, [field]: value });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("rejects unknown fields from the model", () => {
    expect(energyBillSchema.strict().safeParse({ ...validBill, extra: 1 }).success).toBe(false);
  });
});

describe("isValidMpanCore", () => {
  it.each([
    ["1200023456781", true],
    ["1200023456789", false],
    ["2100023456781", false],
  ])("%s -> %s", (mpan, valid) => {
    expect(isValidMpanCore(mpan)).toBe(valid);
  });
});

describe("energyBillRules", () => {
  function failures(overrides: Partial<EnergyBill>): string[] {
    const bill = { ...validBill, ...overrides };
    return energyBillRules.filter((rule) => rule.check(bill) !== null).map((rule) => rule.name);
  }

  it("passes the sample bill", () => {
    expect(failures({})).toEqual([]);
  });

  it("flags a billing period that ends before it starts", () => {
    expect(failures({ billing_period_start: "2026-09-01" })).toContain("billing-period-order");
  });

  it("flags an MPAN with a wrong check digit (a single misread digit)", () => {
    expect(failures({ meter_point_number: "1200023456787" })).toEqual(["mpan-check-digit"]);
  });

  it("does not check digits on a gas MPRN", () => {
    expect(failures({ meter_point_number: "1234567890" })).toEqual([]);
  });

  it("allows line-item rounding in the subtotal but not a wrong figure", () => {
    expect(failures({ subtotal_gbp: 322.49 })).not.toContain("subtotal-arithmetic");
    expect(failures({ consumption_kwh: 1520 })).toEqual(["subtotal-arithmetic"]);
  });

  it("accepts the 5% reduced rate when the figures match", () => {
    expect(failures({ vat_rate_percent: 5, vat_gbp: 16.12, total_gbp: 338.52 })).toEqual([]);
  });

  it("flags a VAT rate that is not a UK energy rate", () => {
    expect(failures({ vat_rate_percent: 17.5, vat_gbp: 56.42, total_gbp: 378.82 })).toEqual([
      "vat-rate",
    ]);
  });

  it("explains a subtotal mismatch with the recomputed figure", () => {
    const rule = energyBillRules.find((r) => r.name === "subtotal-arithmetic");

    expect(rule?.check({ ...validBill, consumption_kwh: 1520 })).toBe(
      "Consumption x unit rate + 31 days standing charge = £388.55, but subtotal is £322.40",
    );
  });
});
