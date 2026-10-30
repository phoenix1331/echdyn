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

// Optional currency before, the number, optional unit after
const PRINTED_NUMBER = /(£|gbp)?\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(pence|p\b|gbp)?/i;

function properties(schema: JsonSchema): Record<string, JsonSchema> {
  const value = schema.properties;
  return typeof value === "object" && value !== null ? (value as Record<string, JsonSchema>) : {};
}

function isNumeric(property: JsonSchema): boolean {
  return typeof property.type === "string" && NUMERIC_TYPES.has(property.type);
}

/** The schema sent to the model: numeric fields become strings copied from the page */
export function toPrintedSchema(schema: JsonSchema): JsonSchema {
  const printed = Object.fromEntries(
    Object.entries(properties(schema)).map(([field, property]) => {
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

function scale(unit: PrintedUnit | undefined, pounds: boolean, pence: boolean): number {
  if (unit === "pence" && pounds) {
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
  const value = Number(match[2].replaceAll(",", "")) * scale(unit, pounds, pence);

  // Scaling leaves float noise (0.183 x 100 = 18.299999999999997)
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Turns printed numeric fields back into numbers using the record schema.
 * Text with no number is left as it is, so schema validation flags it for review.
 */
export function normalisePrinted(
  schema: JsonSchema,
  parsed: Record<string, unknown>,
  units: Readonly<Partial<Record<string, PrintedUnit>>> = {},
): Record<string, unknown> {
  const numeric = new Set(
    Object.entries(properties(schema))
      .filter(([, property]) => isNumeric(property))
      .map(([field]) => field),
  );

  return Object.fromEntries(
    Object.entries(parsed).map(([field, value]) => {
      if (!numeric.has(field) || typeof value !== "string") {
        return [field, value];
      }
      return [field, parsePrintedNumber(value, units[field]) ?? value];
    }),
  );
}
