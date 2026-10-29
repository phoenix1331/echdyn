import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { migrateDatabase, resetDatabase } from "./migrate";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("resetDatabase", () => {
  const { db, close } = createDatabase(testUrl ?? "", { max: 1 });

  afterAll(async () => {
    await migrateDatabase(db);
    await close();
  });

  it("connects with the default pool size", async () => {
    const connection = createDatabase(testUrl ?? "");

    await expect(connection.db.execute(sql`select 1`)).resolves.toHaveLength(1);
    await connection.close();
  });

  it("drops every table and migrations rebuild them", async () => {
    await resetDatabase(db);

    const empty = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    expect(empty).toHaveLength(0);

    await migrateDatabase(db);

    const rebuilt = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    expect(rebuilt).toHaveLength(5);
  });
});
