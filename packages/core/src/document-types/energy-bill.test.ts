import { describe, expect, it } from "vitest";
import { energyBillSchema, type EnergyBill } from "./energy-bill";

const validBill: EnergyBill = {
  supplier: "Northern Power Ltd",
  account_number: "AC-1029384",
  meter_point_number: "1200023456789",
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
