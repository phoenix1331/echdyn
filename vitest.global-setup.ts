import postgres from "postgres";
import { createDatabase, migrateDatabase, resetDatabase } from "@echdyn/core";

export default async function setup(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;

  if (!testUrl) {
    return;
  }

  const url = new URL(testUrl);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";

  const admin = postgres(url.toString(), { max: 1, onnotice: () => undefined });
  const existing = await admin`select 1 from pg_database where datname = ${name}`;

  if (existing.length === 0) {
    await admin.unsafe(`create database "${name}"`);
  }

  await admin.end();

  const { db, close } = createDatabase(testUrl, { max: 1 });
  await resetDatabase(db);
  await migrateDatabase(db);
  await close();
}
