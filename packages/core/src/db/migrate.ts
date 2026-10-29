import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client";

// Built with path.resolve, not new URL(), so bundlers do not treat the folder as an asset
export const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}

export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
}
