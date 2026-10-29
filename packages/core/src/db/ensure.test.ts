import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { ensureDatabase } from "./ensure";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("ensureDatabase", () => {
  const url = new URL(testUrl ?? "postgres://x/y");
  url.pathname = `/echdyn_ensure_${String(Date.now())}`;
  const name = url.pathname.slice(1);

  afterAll(async () => {
    const admin = new URL(testUrl ?? "");
    admin.pathname = "/postgres";
    const sql = postgres(admin.toString(), { max: 1, onnotice: () => undefined });
    await sql.unsafe(`drop database if exists "${name}"`);
    await sql.end();
  });

  it("creates a missing database once", async () => {
    await expect(ensureDatabase(url.toString())).resolves.toBe(true);
    await expect(ensureDatabase(url.toString())).resolves.toBe(false);
  });
});
