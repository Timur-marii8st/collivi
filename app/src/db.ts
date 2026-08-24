import { Pool } from "pg";
import { readFile } from "fs/promises";
import { join } from "path";
import { DATABASE_URL } from "./config";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
});
pool.on("error", (e) => console.error("PG pool error", e.message));

export async function initDb() {
  const schema = await readFile(join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  // миграция: однополые группы — prefer_gender приводим к gender
  await pool.query("UPDATE users SET prefer_gender = gender WHERE gender IS NOT NULL AND prefer_gender IS DISTINCT FROM gender").catch(() => {});
}

export function one<T>(rows: T[]): T | null {
  return rows.length ? rows[0] : null;
}
