import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/** The database or a transaction on it: for writes that must commit together with others */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseConnection {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(url: string, options: { max?: number } = {}): DatabaseConnection {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}
