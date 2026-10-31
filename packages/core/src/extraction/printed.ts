/**
 * Small models misread numbers when the decoding grammar forces bare JSON numbers: `£1,526.95`
 * comes out as `1.52695` or `1526`, and a rate printed in pounds is copied without converting.
 * So the model copies numeric fields as printed text, and code turns them into numbers.
 */

/** The unit a numeric field is stored in, when printed values may use another */
export type PrintedUnit = "pence" | "pounds";

type JsonSchema = Record<string, unknown>;

const NUMERIC_TYPES = new Set(["number", "integer"]);
const COPY_AS_PRINTED =
  "Copy it exactly as printed, including any £, p, %, units and thousands separators.";

// Becomes part of the decoding grammar: only a currency may come before the number and up to
// three unit words after, so the model cannot answer "", "Not provided" or a label with a number
const PRINTED_PATTERN = "^(£|GBP )?-?[0-9][0-9,]*(\\.[0-9]+)?( ?[A-Za-z/%]{1,8}){0,3}$";

// Dates as printed: something date-like, never "" or "Not provided"
const PRINTED_DATE_PATTERN = "^[0-9]{1,4}[A-Za-z]{0,2}[ ./-][0-9A-Za-z]{1,9}[ ./-][0-9]{2,4}$";
const COPY_DATE_AS_PRINTED =
  "Copy the date exactly as printed, for example 01/08/2026, 1 August 2026 or 01-Aug-26.";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Optional currency before, the number, optional unit after
const PRINTED_NUMBER = /(£|gbp)?\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(pence|p\b|gbp)?/i;

function properties(schema: JsonSchema): Record<string, JsonSchema> {
  const value = schema.properties;
  return typeof value === "object" && value !== null ? (value as Record<string, JsonSchema>) : {};
}

function isNumeric(property: JsonSchema): boolean {
  return typeof property.type === "string" && NUMERIC_TYPES.has(property.type);
}

function isDate(property: JsonSchema): boolean {
  return property.type === "string" && property.format === "date";
}

export interface PrintedOptions {
  /**
   * Dates copied as printed too. Ollama turns `format: date` into a grammar that forces
   * YYYY-MM-DD, and a small vision model reading "10 February 2026" under it writes digits
   * in page order ("1002-02-26") instead of converting
   */
  dates?: boolean;
}

/** The schema sent to the model: numeric (and optionally date) fields become strings copied from the page */
export function toPrintedSchema(schema: JsonSchema, options: PrintedOptions = {}): JsonSchema {
  const printed = Object.fromEntries(
    Object.entries(properties(schema)).map(([field, property]) => {
      if (options.dates && isDate(property)) {
        // Without the format, Ollama no longer forces the YYYY-MM-DD grammar
        const rest = { ...property };
        delete rest.format;
        const description =
          typeof property.description === "string" ? `${property.description}. ` : "";
        return [
          field,
          {
            ...rest,
            pattern: PRINTED_DATE_PATTERN,
            description: `${description}${COPY_DATE_AS_PRINTED}`,
          },
        ];
      }
      if (!isNumeric(property)) {
        return [field, property];
      }
      const description =
        typeof property.description === "string" ? `${property.description}. ` : "";
      return [
        field,
        {
          type: "string",
          pattern: PRINTED_PATTERN,
          description: `${description}${COPY_AS_PRINTED}`,
        },
      ];
    }),
  );
  return { ...schema, properties: printed };
}

function scale(
  unit: PrintedUnit | undefined,
  pounds: boolean,
  pence: boolean,
  value: number,
): number {
  if (unit === "pence" && pounds) {
    return 100;
  }
  // A bare rate under 1 cannot be pence (no UK unit rate or standing charge is below 1p):
  // the model dropped the £ from a rate printed in pounds, as in £0.1830/kWh
  if (unit === "pence" && !pence && Math.abs(value) < 1) {
    return 100;
  }
  if (unit === "pounds" && pence) {
    return 0.01;
  }
  return 1;
}

/** `£1,526.95` is 1526.95; with unit `pence`, `£0.1830/kWh` is 18.3; null when there is no number */
export function parsePrintedNumber(text: string, unit?: PrintedUnit): number | null {
  const match = PRINTED_NUMBER.exec(text);
  if (!match?.[2]) {
    return null;
  }

  const suffix = match[3]?.toLowerCase();
  const pounds = match[1] !== undefined || suffix === "gbp";
  const pence = suffix === "p" || suffix === "pence";
  const number = Number(match[2].replaceAll(",", ""));
  const value = number * scale(unit, pounds, pence, number);

  // Scaling leaves float noise (0.183 x 100 = 18.299999999999997)
  return Math.round(value * 1e6) / 1e6;
}

function iso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31/02 and the like rather than letting Date roll it into March
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * A printed date as YYYY-MM-DD, or null. Numeric dates are read day first, as UK bills
 * print them (01/08/2026 is 1 August); two-digit years are this century.
 */
export function parsePrintedDate(text: string): string | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/, "$1");
  const fullYear = (year: string) => Number(year.length === 2 ? `20${year}` : year);

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (isoMatch) {
    return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(value);
  if (numeric) {
    return iso(fullYear(numeric[3] ?? ""), Number(numeric[2]), Number(numeric[1]));
  }

  const named = /^(\d{1,2})[ .-]+([a-z]{3,9})[ .,-]+(\d{2}|\d{4})$/.exec(value);
  const month = MONTHS.indexOf(named?.[2]?.slice(0, 3) ?? "");
  if (named && month >= 0) {
    return iso(fullYear(named[3] ?? ""), month + 1, Number(named[1]));
  }

  return null;
}

/**
 * Turns printed numeric fields back into numbers, and printed dates into YYYY-MM-DD, using
 * the record schema.
 * Text with no number is left as it is, so schema validation flags it for review.
 */
export function normalisePrinted(
  schema: JsonSchema,
  parsed: Record<string, unknown>,
  units: Readonly<Partial<Record<string, PrintedUnit>>> = {},
): Record<string, unknown> {
  const fields = properties(schema);

  return Object.fromEntries(
    Object.entries(parsed).map(([field, value]) => {
      const property = fields[field];
      if (!property || typeof value !== "string") {
        return [field, value];
      }
      if (isNumeric(property)) {
        return [field, parsePrintedNumber(value, units[field]) ?? value];
      }
      // ISO dates come back unchanged, so the text path (grammar-forced ISO) is unaffected
      if (isDate(property)) {
        return [field, parsePrintedDate(value) ?? value];
      }
      return [field, value];
    }),
  );
}
