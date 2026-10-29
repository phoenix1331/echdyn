// INSERT ... RETURNING always yields the row, but the array type cannot say so
export function firstRow<T>(rows: T[], context: string): T {
  const [row] = rows;

  if (row === undefined) {
    throw new Error(`${context} returned no row`);
  }

  return row;
}
