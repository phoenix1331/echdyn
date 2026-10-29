import { createDatabase } from "../db";
import { seedDocumentTypes } from "../document-types";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const { db, close } = createDatabase(url, { max: 1 });

try {
  const { inserted, unchanged } = await seedDocumentTypes(db);
  console.log(`document types inserted: ${inserted.join(", ") || "none"}`);
  console.log(`document types unchanged: ${unchanged.join(", ") || "none"}`);
} finally {
  await close();
}
