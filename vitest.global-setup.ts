import { createDatabase, ensureDatabase, migrateDatabase, resetDatabase } from "@echdyn/core";

export default async function setup(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;

  if (!testUrl) {
    return;
  }

  await ensureDatabase(testUrl);

  const { db, close } = createDatabase(testUrl, { max: 1 });
  await resetDatabase(db);
  await migrateDatabase(db);
  await close();
}
