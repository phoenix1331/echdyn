const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type DateStyle = "numeric" | "long" | "short";

/** 2026-08-01 as 01/08/2026, 1 August 2026 or 01-Aug-26 */
export function formatDate(iso: string, style: DateStyle): string {
  const [year = "", month = "", day = ""] = iso.split("-");
  const name = MONTH_NAMES[Number(month) - 1] ?? "";

  if (style === "numeric") {
    return `${day}/${month}/${year}`;
  }
  if (style === "long") {
    return `${String(Number(day))} ${name} ${year}`;
  }
  return `${day}-${name.slice(0, 3)}-${year.slice(2)}`;
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatGbp(value: number, symbol = true): string {
  return `${symbol ? "£" : ""}${formatNumber(value, 2)}`;
}

export function formatKwh(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 1);
}
