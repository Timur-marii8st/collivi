import { Pool } from "pg";
import { readFile } from "fs/promises";
import { join } from "path";
import { DATABASE_URL } from "./config";

export const pool = new Pool({ connectionString: DATABASE_URL });

export async function initDb() {
  const schema = await readFile(join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
}

export function one<T>(rows: T[]): T | null {
  return rows.length ? rows[0] : null;
}
