import { describe, expect, it } from "vitest";
import { energyBill, type EnergyBill } from "../document-types/energy-bill";
import { validateExtraction } from "./validate";

const bill: EnergyBill = {
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

describe("validateExtraction", () => {
  it("passes a bill whose figures add up", () => {
    expect(validateExtraction(energyBill, bill)).toEqual({ data: bill, errors: [] });
  });

  it("flags the VAT misread from the first live llama3.2 run", () => {
    const { errors } = validateExtraction(energyBill, { ...bill, vat_gbp: 386.88 });

    expect(errors.map((e) => `${e.rule ?? ""}:${e.field}`)).toEqual([
      "vat-amount:subtotal_gbp",
      "vat-amount:vat_rate_percent",
      "vat-amount:vat_gbp",
      "total-adds-up:subtotal_gbp",
      "total-adds-up:vat_gbp",
      "total-adds-up:total_gbp",
    ]);
    expect(errors[0]?.message).toBe("20% VAT on £322.40 is £64.48, but VAT is £386.88");
    expect(errors[3]?.message).toBe("Subtotal + VAT = £709.28, but total is £386.88");
  });

  it("reports schema errors per field and skips business rules", () => {
    const { data, errors } = validateExtraction(energyBill, {
      ...bill,
      total_gbp: "386.88",
      billing_period_end: "31/08/2026",
      vat_gbp: 1,
    });

    expect(data).toBeNull();
    expect(errors.map((e) => e.field).sort()).toEqual(["billing_period_end", "total_gbp"]);
    expect(errors.every((e) => e.rule === undefined)).toBe(true);
  });

  it("reports a missing field", () => {
    const partial: Partial<EnergyBill> = { ...bill };
    delete partial.supplier;

    expect(validateExtraction(energyBill, partial).errors).toEqual([
      expect.objectContaining({ field: "supplier" }),
    ]);
  });

  it("attributes a non-object to _root", () => {
    expect(validateExtraction(energyBill, null).errors).toEqual([
      expect.objectContaining({ field: "_root" }),
    ]);
  });
});
