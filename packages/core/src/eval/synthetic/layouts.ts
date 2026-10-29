import type { SyntheticBill } from "./bill";
import { formatDate, formatGbp, formatKwh, formatNumber } from "./format";

export interface Line {
  text: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
}

export type Page = Line[];

export interface Layout {
  supplier: string;
  render: (bill: SyntheticBill, withHistoryPage: boolean) => Page[];
}

const LEFT = 56;
const RIGHT = 400;

/** Stacks lines top-down so layouts read like documents rather than coordinates */
function column(startY: number, gap = 16) {
  let y = startY;
  return (text: string, x = LEFT, options: Pick<Line, "size" | "bold"> = {}): Line => {
    const line = { text, x, y, ...options };
    y -= (options.size ?? 10) + gap - 10;
    return line;
  };
}

/** A label on the left and an amount right-aligned in a column on the same line */
function pair(
  next: ReturnType<typeof column>,
  label: string,
  amount: string,
  options: Pick<Line, "size" | "bold"> = {},
  amountX = RIGHT + 60,
): Line[] {
  const line = next(label, LEFT, options);
  return [line, { text: amount, x: amountX, y: line.y, ...options }];
}

function meterLabel(bill: SyntheticBill): string {
  return bill.fuel === "gas" ? "MPRN" : "MPAN";
}

function gasConversionLine(bill: SyntheticBill): string | null {
  if (!bill.gasConversion) {
    return null;
  }
  const { cubicMetres, calorificValue } = bill.gasConversion;
  return `Gas used: ${formatNumber(cubicMetres)} m3 x 1.02264 x ${calorificValue.toFixed(1)} CV / 3.6 = ${formatKwh(bill.expected.consumption_kwh)} kWh`;
}

function historyPage(bill: SyntheticBill, title: string): Page {
  const next = column(780);
  return [
    next(title, LEFT, { size: 14, bold: true }),
    next("Month            kWh"),
    ...bill.usageHistory.map((h) => next(`${h.month.padEnd(16)} ${formatNumber(h.kwh)}`)),
    next(""),
    next("Prices are fixed for the term of your contract. Late payment may incur a fee of £25.00."),
    next("Call 0800 000 0000 to report a fault. Lines are open 8am to 6pm, Monday to Friday."),
  ];
}

function present<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

export const layouts: readonly Layout[] = [
  {
    supplier: "Northern Power Ltd",
    render(bill, withHistoryPage) {
      const b = bill.expected;
      const next = column(790);
      const fuelName = bill.fuel === "gas" ? "Gas" : "Electricity";
      const page = present([
        next(this.supplier, LEFT, { size: 18, bold: true }),
        next(`Business ${fuelName} Bill`, LEFT, { size: 11 }),
        next(bill.customer.name),
        ...bill.customer.address.map((line) => next(line)),
        next(""),
        next(`Account number: ${b.account_number}`),
        next(`${meterLabel(bill)}: ${b.meter_point_number}`),
        next(
          `Billing period: ${formatDate(b.billing_period_start, "numeric")} to ${formatDate(b.billing_period_end, "numeric")} (${String(bill.days)} days)`,
        ),
        next(
          `Previous balance ${formatGbp(bill.previousBalanceGbp)}   Payment received, thank you ${formatGbp(bill.paymentReceivedGbp)}`,
        ),
        next(
          `Meter readings: previous ${formatNumber(bill.meterReadings.previous)}, current ${formatNumber(bill.meterReadings.current)}`,
        ),
        ...present([gasConversionLine(bill)]).map((text) => next(text)),
        next(""),
        ...pair(
          next,
          `${fuelName} used: ${formatKwh(b.consumption_kwh)} kWh at ${b.unit_rate_pence.toFixed(2)}p per kWh`,
          formatGbp(bill.energyChargeGbp),
        ),
        ...pair(
          next,
          `Standing charge: ${String(bill.days)} days at ${b.standing_charge_pence_per_day.toFixed(2)}p per day`,
          formatGbp(bill.standingChargeGbp),
        ),
        ...pair(next, "Subtotal (excluding VAT)", formatGbp(b.subtotal_gbp)),
        ...pair(next, `VAT at ${String(b.vat_rate_percent)}%`, formatGbp(b.vat_gbp)),
        ...pair(next, "Total amount due", formatGbp(b.total_gbp), { size: 12, bold: true }),
      ]);
      return withHistoryPage
        ? [page, historyPage(bill, "Your usage over the last 12 months")]
        : [page];
    },
  },
  {
    supplier: "Severn Valley Energy",
    render(bill, withHistoryPage) {
      const b = bill.expected;
      const next = column(790, 18);
      const amountX = RIGHT + 40;
      const page = present([
        next("SEVERN VALLEY ENERGY", LEFT, { size: 16, bold: true }),
        next(`Your ${bill.fuel} statement`),
        next(`Customer reference ${b.account_number}`),
        next(`Supply number (${meterLabel(bill)}) ${b.meter_point_number}`),
        next(
          `Statement covers ${formatDate(b.billing_period_start, "long")} - ${formatDate(b.billing_period_end, "long")}`,
        ),
        next(
          `Opening balance ${formatGbp(bill.previousBalanceGbp, false)} GBP, paid ${formatGbp(bill.paymentReceivedGbp, false)} GBP`,
        ),
        next(
          `Readings ${String(bill.meterReadings.previous)} (E) to ${String(bill.meterReadings.current)} (A)`,
        ),
        ...present([gasConversionLine(bill)]).map((text) => next(text)),
        next(""),
        ...pair(next, "Charges", "GBP", { bold: true }, amountX),
        // Rates in pounds: the model must convert to pence for the schema
        ...pair(
          next,
          `Energy  ${formatKwh(b.consumption_kwh)} kWh @ £${(b.unit_rate_pence / 100).toFixed(4)}/kWh`,
          formatGbp(bill.energyChargeGbp, false),
          {},
          amountX,
        ),
        ...pair(
          next,
          `Daily charge  ${String(bill.days)} days @ £${(b.standing_charge_pence_per_day / 100).toFixed(4)} per day`,
          formatGbp(bill.standingChargeGbp, false),
          {},
          amountX,
        ),
        ...pair(next, "Net amount", formatGbp(b.subtotal_gbp, false), { bold: true }, amountX),
        ...pair(
          next,
          `VAT @ ${String(b.vat_rate_percent)}%`,
          formatGbp(b.vat_gbp, false),
          {},
          amountX,
        ),
        ...pair(
          next,
          "Amount to pay",
          formatGbp(b.total_gbp, false),
          { size: 13, bold: true },
          amountX,
        ),
        {
          text: `Bill to: ${bill.customer.name}, ${bill.customer.address.join(", ")}`,
          x: LEFT,
          y: 80,
          size: 8,
        },
      ]);
      return withHistoryPage ? [page, historyPage(bill, "Twelve month usage")] : [page];
    },
  },
  {
    supplier: "Cymru Gas & Power",
    render(bill, withHistoryPage) {
      const b = bill.expected;
      const next = column(790, 17);
      const row = (description: string, quantity: string, rate: string, amount: string): Line[] => {
        const line = next(description);
        return [
          line,
          { text: quantity, x: 250, y: line.y },
          { text: rate, x: 340, y: line.y },
          { text: amount, x: 470, y: line.y },
        ];
      };
      const page = present([
        next("Cymru Gas & Power", LEFT, { size: 17, bold: true }),
        next(`Invoice for ${bill.customer.name}`),
        next(`Acct: ${b.account_number}     Meter point ref: ${b.meter_point_number}`),
        next(
          `Period ${formatDate(b.billing_period_start, "short")} to ${formatDate(b.billing_period_end, "short")}`,
        ),
        next(
          `Balance b/f ${formatGbp(bill.previousBalanceGbp)}     Received ${formatGbp(bill.paymentReceivedGbp)}`,
        ),
        ...present([gasConversionLine(bill)]).map((text) => next(text)),
        next(""),
        ...row("Description", "Quantity", "Rate", "Amount"),
        ...row(
          "Unit charge",
          `${formatKwh(b.consumption_kwh)} kWh`,
          `${b.unit_rate_pence.toFixed(2)} p/kWh`,
          formatGbp(bill.energyChargeGbp),
        ),
        ...row(
          "Standing charge",
          `${String(bill.days)} days`,
          `${b.standing_charge_pence_per_day.toFixed(2)} p/day`,
          formatGbp(bill.standingChargeGbp),
        ),
        ...row("Charges before VAT", "", "", formatGbp(b.subtotal_gbp)),
        ...row(`VAT`, "", `${String(b.vat_rate_percent)}%`, formatGbp(b.vat_gbp)),
        next(""),
        next(
          `Total due by ${formatDate(b.billing_period_end, "short")}: ${formatGbp(b.total_gbp)}`,
          LEFT,
          { size: 13, bold: true },
        ),
        next(
          `Meter reads ${formatNumber(bill.meterReadings.previous)} / ${formatNumber(bill.meterReadings.current)}`,
        ),
      ]);
      return withHistoryPage ? [page, historyPage(bill, "Defnydd / Usage history")] : [page];
    },
  },
];
