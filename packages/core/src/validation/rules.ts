export interface BusinessRule<T> {
  name: string;
  /** Fields to flag for review when the rule fails */
  fields: readonly (keyof T & string)[];
  /**
   * Returns a reviewer-facing message when the rule fails, otherwise null.
   * Method syntax (bivariant) so definitions with different shapes fit one registry.
   */
  check(data: T): string | null;
}

export function approxEqual(a: number, b: number, tolerance: number): boolean {
  // Small epsilon absorbs binary floating point noise (0.1 + 0.2 !== 0.3)
  return Math.abs(a - b) <= tolerance + 1e-9;
}

/** Days in a billing period, counting both the first and last day */
export function daysInclusive(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
}

export function gbp(value: number): string {
  return `£${value.toFixed(2)}`;
}
