import { describe, expect, it } from "vitest";
import { energyBill, isValidMpanCore } from "../../document-types/energy-bill";
import { validateExtraction } from "../../validation/validate";
import { createRandom } from "../random";
import { generateBill, mpanWithCheckDigit } from "./bill";

describe("mpanWithCheckDigit", () => {
  it("appends a check digit that validates", () => {
    expect(mpanWithCheckDigit("120002345678")).toBe("1200023456781");
    expect(isValidMpanCore(mpanWithCheckDigit("987654321012"))).toBe(true);
  });
});

describe("generateBill", () => {
  it("always produces ground truth that passes every business rule", () => {
    for (let seed = 0; seed < 300; seed++) {
      const bill = generateBill(createRandom(seed), "Test Energy");
      const { errors } = validateExtraction(energyBill, bill.expected);

      expect(errors, `seed ${String(seed)}`).toEqual([]);
    }
  });

  it("covers both fuels, both VAT rates and fractional kWh", () => {
    const bills = Array.from({ length: 200 }, (_, seed) =>
      generateBill(createRandom(seed), "Test Energy"),
    );

    expect(new Set(bills.map((b) => b.fuel))).toEqual(new Set(["electricity", "gas"]));
    expect(new Set(bills.map((b) => b.expected.vat_rate_percent))).toEqual(new Set([5, 20]));
    expect(bills.some((b) => !Number.isInteger(b.expected.consumption_kwh))).toBe(true);
  });

  it("derives gas kWh from the printed volume conversion", () => {
    const gas = Array.from({ length: 50 }, (_, seed) =>
      generateBill(createRandom(seed), "Test Energy"),
    ).find((b) => b.fuel === "gas");

    const { cubicMetres, calorificValue } = gas?.gasConversion ?? {
      cubicMetres: 0,
      calorificValue: 0,
    };
    expect(gas?.expected.consumption_kwh).toBe(
      Math.round((cubicMetres * 1.02264 * calorificValue) / 3.6),
    );
    expect(gas?.expected.meter_point_number).toMatch(/^\d{6,10}$/);
  });
});
