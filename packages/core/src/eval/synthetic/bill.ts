import type { EnergyBill } from "../../document-types/energy-bill";
import { daysInclusive } from "../../validation/rules";
import type { Random } from "../random";

export type Fuel = "electricity" | "gas";

/** Everything a layout needs to print a bill, plus the ground truth it must match */
export interface SyntheticBill {
  expected: EnergyBill;
  fuel: Fuel;
  days: number;
  energyChargeGbp: number;
  standingChargeGbp: number;
  previousBalanceGbp: number;
  paymentReceivedGbp: number;
  meterReadings: { previous: number; current: number };
  /** Gas only: volume and conversion printed on the bill */
  gasConversion?: { cubicMetres: number; calorificValue: number };
  usageHistory: { month: string; kwh: number }[];
  customer: { name: string; address: string[] };
}

const MPAN_WEIGHTS = [3, 5, 7, 13, 17, 19, 23, 29, 31, 37, 41, 43];
const GAS_VOLUME_CORRECTION = 1.02264;
const CUSTOMERS = [
  { name: "Harbour Street Bakery Ltd", address: ["14 Harbour Street", "Whitby", "YO21 3PU"] },
  { name: "Pennine Joinery", address: ["Unit 7, Mill Lane", "Hebden Bridge", "HX7 8AD"] },
  { name: "The Copper Kettle Cafe", address: ["2 Market Place", "Ludlow", "SY8 1AQ"] },
  { name: "Brightwater Dental Practice", address: ["88 Station Road", "Llandudno", "LL30 2HE"] },
  { name: "Northgate Print & Design", address: ["5 Northgate", "Chester", "CH1 2HQ"] },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const round2 = (value: number) => Math.round(value * 100) / 100;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function mpanWithCheckDigit(first12: string): string {
  const sum = MPAN_WEIGHTS.reduce((total, weight, i) => total + weight * Number(first12[i]), 0);
  return `${first12}${String((sum % 11) % 10)}`;
}

function digits(random: Random, length: number): string {
  return Array.from({ length }, (_, i) => String(random.int(i === 0 ? 1 : 0, 9))).join("");
}

interface Reading {
  consumption_kwh: number;
  gasConversion?: SyntheticBill["gasConversion"];
}

/** Gas is metered by volume: kWh = m3 x volume correction x calorific value / 3.6 */
function gasReading(random: Random): Reading {
  const cubicMetres = random.int(80, 1400);
  const calorificValue = random.decimal(38.8, 40.2, 1);
  return {
    consumption_kwh: Math.round((cubicMetres * GAS_VOLUME_CORRECTION * calorificValue) / 3.6),
    gasConversion: { cubicMetres, calorificValue },
  };
}

/** Mostly whole kWh, sometimes a decimal reading */
function electricityReading(random: Random): Reading {
  return {
    consumption_kwh: random.chance(0.8) ? random.int(200, 6000) : random.decimal(200, 6000, 1),
  };
}

export function generateBill(random: Random, supplier: string): SyntheticBill {
  const fuel: Fuel = random.chance(0.7) ? "electricity" : "gas";
  const start = new Date(Date.UTC(random.pick([2025, 2026]), random.int(0, 11), random.int(1, 28)));
  const end = new Date(start.getTime() + random.int(27, 34) * 86_400_000);
  const billing_period_start = isoDate(start);
  const billing_period_end = isoDate(end);
  const days = daysInclusive(billing_period_start, billing_period_end);

  const { consumption_kwh, gasConversion } =
    fuel === "gas" ? gasReading(random) : electricityReading(random);

  const unit_rate_pence = fuel === "gas" ? random.decimal(5.5, 11.9, 2) : random.decimal(18, 34, 2);
  const standing_charge_pence_per_day = random.decimal(20, 120, 2);
  const energyChargeGbp = round2((consumption_kwh * unit_rate_pence) / 100);
  const standingChargeGbp = round2((days * standing_charge_pence_per_day) / 100);
  const subtotal_gbp = round2(energyChargeGbp + standingChargeGbp);
  const vat_rate_percent = random.chance(0.85) ? 20 : 5;
  const vat_gbp = round2((subtotal_gbp * vat_rate_percent) / 100);
  const total_gbp = round2(subtotal_gbp + vat_gbp);

  const previousReading = random.int(10_000, 90_000);
  const readingUnits = gasConversion?.cubicMetres ?? Math.round(consumption_kwh);
  const previousBalanceGbp = random.decimal(50, 900, 2);

  return {
    expected: {
      supplier,
      account_number: random.pick([
        `AC-${digits(random, 7)}`,
        digits(random, 8),
        `${digits(random, 2)}/${digits(random, 3)}-${digits(random, 3)}`,
      ]),
      meter_point_number:
        fuel === "gas" ? digits(random, random.int(6, 10)) : mpanWithCheckDigit(digits(random, 12)),
      billing_period_start,
      billing_period_end,
      consumption_kwh,
      unit_rate_pence,
      standing_charge_pence_per_day,
      subtotal_gbp,
      vat_rate_percent,
      vat_gbp,
      total_gbp,
    },
    fuel,
    days,
    energyChargeGbp,
    standingChargeGbp,
    previousBalanceGbp,
    paymentReceivedGbp: random.chance(0.8) ? previousBalanceGbp : random.decimal(10, 500, 2),
    meterReadings: { previous: previousReading, current: previousReading + readingUnits },
    ...(gasConversion ? { gasConversion } : {}),
    usageHistory: Array.from({ length: 12 }, (_, i) => ({
      month: MONTHS[(start.getUTCMonth() + 12 - i) % 12] ?? "Jan",
      kwh: Math.round(consumption_kwh * random.decimal(0.6, 1.4, 2)),
    })),
    customer: random.pick(CUSTOMERS),
  };
}
