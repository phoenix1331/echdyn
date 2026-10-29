import { createDatabase, migrateDatabase, resetDatabase } from "../db";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const fresh = process.argv.includes("--fresh");
const { db, close } = createDatabase(url, { max: 1 });

if (fresh) {
  await resetDatabase(db);
  console.log("dropped all tables");
}

await migrateDatabase(db);
console.log("migrations applied");
await close();
