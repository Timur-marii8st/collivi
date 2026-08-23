export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));
export const WEBAPP_URL = process.env.WEBAPP_URL || "";
export const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://corenting:corenting@localhost:5432/corenting";
export const PORT = parseInt(process.env.PORT || "3000", 10);
