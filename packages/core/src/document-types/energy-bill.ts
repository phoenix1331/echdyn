import { z } from "zod";
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

export const energyBill: DocumentTypeDefinition<typeof energyBillSchema> = {
  slug: "uk-energy-bill",
  name: "UK business energy bill",
  version: 1,
  schema: energyBillSchema,
};
