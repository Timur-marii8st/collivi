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
export const NODE_ENV = process.env.NODE_ENV || "development";

// Пустой BOT_TOKEN => initData проверяется HMAC на пустом ключе => обход
// аутентификации. Лучше не стартовать.
export function assertConfig(): void {
  const missing: string[] = [];
  if (!BOT_TOKEN) missing.push("BOT_TOKEN");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (missing.length) {
    console.error(
      `Не заданы обязательные переменные окружения: ${missing.join(", ")}. ` +
        `Заполни .env (см. .env.example) и перезапусти.`
    );
    process.exit(1);
  }
  if (!WEBAPP_URL) console.warn("WEBAPP_URL не задан — кнопки Mini App в боте не откроются");
  if (!ADMIN_IDS.length) console.warn("ADMIN_IDS не задан — админка выключена");
}
