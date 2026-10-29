import postgres from "postgres";

/** Creates the database named in `url` if it does not exist, via the server's `postgres` database */
export async function ensureDatabase(url: string): Promise<boolean> {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  target.pathname = "/postgres";

  const admin = postgres(target.toString(), { max: 1, onnotice: () => undefined });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${name}`;
    if (existing.length > 0) {
      return false;
    }
    await admin.unsafe(`create database "${name.replaceAll('"', '""')}"`);
    return true;
  } finally {
    await admin.end();
  }
}
