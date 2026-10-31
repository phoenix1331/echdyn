import { z } from "zod";
import { approxEqual, daysInclusive, gbp, type BusinessRule } from "../validation/rules";
import type { DocumentTypeDefinition } from "./registry";

const money = z.number().nonnegative();

export const energyBillSchema = z.object({
  supplier: z.string().min(1).describe("Energy supplier name as printed on the bill"),
  account_number: z.string().min(1).describe("Customer account number"),
  meter_point_number: z
    .string()
    .regex(/^\d{6,13}$/)
    .describe("Meter point number: 13-digit MPAN core for electricity, 6 to 10 digit MPRN for gas"),
  billing_period_start: z.iso.date().describe("First day of the billing period (YYYY-MM-DD)"),
  billing_period_end: z.iso.date().describe("Last day of the billing period (YYYY-MM-DD)"),
  consumption_kwh: z.number().nonnegative().describe("Energy used in the period, in kWh"),
  unit_rate_pence: z.number().positive().describe("Price per kWh in pence, excluding VAT"),
  standing_charge_pence_per_day: z
    .number()
    .nonnegative()
    .describe("Daily standing charge in pence, excluding VAT"),
  subtotal_gbp: money.describe("Total charges before VAT, in pounds"),
  vat_rate_percent: z.number().nonnegative().describe("VAT rate applied, as a percentage"),
  vat_gbp: money.describe("VAT amount, in pounds"),
  total_gbp: money.describe("Total amount due including VAT, in pounds"),
});

export type EnergyBill = z.infer<typeof energyBillSchema>;

/** UK VAT on business energy: standard 20%, reduced 5% (de minimis use), 0% if exempt */
export const UK_ENERGY_VAT_RATES = [0, 5, 20] as const;

const MPAN_WEIGHTS = [3, 5, 7, 13, 17, 19, 23, 29, 31, 37, 41, 43];

/** Bills round each line item, so the recomputed subtotal may drift by a few pence */
const SUBTOTAL_TOLERANCE_GBP = 0.1;
const ROUNDING_TOLERANCE_GBP = 0.02;

export function isValidMpanCore(mpan: string): boolean {
  const digits = Array.from(mpan, Number);
  const sum = MPAN_WEIGHTS.reduce((total, weight, i) => total + weight * (digits[i] ?? 0), 0);
  return (sum % 11) % 10 === digits[12];
}

export const energyBillRules: readonly BusinessRule<EnergyBill>[] = [
  {
    name: "billing-period-order",
    fields: ["billing_period_start", "billing_period_end"],
    check: (bill) =>
      bill.billing_period_end >= bill.billing_period_start
        ? null
        : "Billing period ends before it starts",
  },
  {
    name: "mpan-check-digit",
    fields: ["meter_point_number"],
    // 13 digits is an electricity MPAN core with a check digit; gas MPRNs have none
    check: (bill) =>
      bill.meter_point_number.length !== 13 || isValidMpanCore(bill.meter_point_number)
        ? null
        : "MPAN check digit does not match: likely a misread digit",
  },
  {
    name: "subtotal-arithmetic",
    fields: ["consumption_kwh", "unit_rate_pence", "standing_charge_pence_per_day", "subtotal_gbp"],
    check: (bill) => {
      const days = daysInclusive(bill.billing_period_start, bill.billing_period_end);
      const expected =
        (bill.consumption_kwh * bill.unit_rate_pence + days * bill.standing_charge_pence_per_day) /
        100;
      return approxEqual(expected, bill.subtotal_gbp, SUBTOTAL_TOLERANCE_GBP)
        ? null
        : `Consumption x unit rate + ${days} days standing charge = ${gbp(expected)}, but subtotal is ${gbp(bill.subtotal_gbp)}`;
    },
  },
  {
    name: "vat-rate",
    fields: ["vat_rate_percent"],
    check: (bill) =>
      (UK_ENERGY_VAT_RATES as readonly number[]).includes(bill.vat_rate_percent)
        ? null
        : `VAT rate ${bill.vat_rate_percent}% is not a UK energy rate (${UK_ENERGY_VAT_RATES.join(", ")}%)`,
  },
  {
    name: "vat-amount",
    fields: ["subtotal_gbp", "vat_rate_percent", "vat_gbp"],
    check: (bill) => {
      const expected = (bill.subtotal_gbp * bill.vat_rate_percent) / 100;
      return approxEqual(expected, bill.vat_gbp, ROUNDING_TOLERANCE_GBP)
        ? null
        : `${bill.vat_rate_percent}% VAT on ${gbp(bill.subtotal_gbp)} is ${gbp(expected)}, but VAT is ${gbp(bill.vat_gbp)}`;
    },
  },
  {
    name: "total-adds-up",
    fields: ["subtotal_gbp", "vat_gbp", "total_gbp"],
    check: (bill) => {
      const expected = bill.subtotal_gbp + bill.vat_gbp;
      return approxEqual(expected, bill.total_gbp, ROUNDING_TOLERANCE_GBP)
        ? null
        : `Subtotal + VAT = ${gbp(expected)}, but total is ${gbp(bill.total_gbp)}`;
    },
  },
];

export const energyBill: DocumentTypeDefinition<typeof energyBillSchema> = {
  slug: "uk-energy-bill",
  name: "UK business energy bill",
  version: 1,
  schema: energyBillSchema,
  rules: energyBillRules,
  display: {
    supplier: { label: "Supplier" },
    account_number: { label: "Account number" },
    meter_point_number: { label: "Meter point (MPAN or MPRN)" },
    billing_period_start: { label: "Period start" },
    billing_period_end: { label: "Period end" },
    consumption_kwh: { label: "Consumption", unit: "kWh" },
    unit_rate_pence: { label: "Unit rate", unit: "p/kWh" },
    standing_charge_pence_per_day: { label: "Standing charge", unit: "p/day" },
    subtotal_gbp: { label: "Subtotal", currency: true },
    vat_rate_percent: { label: "VAT rate", unit: "%" },
    vat_gbp: { label: "VAT", currency: true },
    total_gbp: { label: "Total", currency: true },
  },
  extraction: {
    // Each hint answers a look-alike value the eval caught the model taking instead
    hints: [
      "The supplier is the energy company that issued the bill, usually named at the top. It is never the customer being billed.",
      "The account number is the customer account or reference number. It is never the MPAN, MPRN or supply number.",
      "The meter point number is the MPAN, MPRN or supply number. It is never a meter reading.",
      "Consumption is the kWh charged for in this period, on the energy charge line. Ignore meter readings, gas volumes in m3 and usage history.",
      "The VAT amount is the money on the VAT line. It is not the VAT rate and not the total.",
      "Ignore previous balances, opening balances and payments received.",
    ],
    units: {
      unit_rate_pence: "pence",
      standing_charge_pence_per_day: "pence",
      subtotal_gbp: "pounds",
      vat_gbp: "pounds",
      total_gbp: "pounds",
    },
  },
};
