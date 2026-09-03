// Общий boot: реальные роуты из app/dist на Fastify, pool -> pglite (WASM Postgres).
// Требует собранный бэкенд (npm --prefix app run build).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

process.env.BOT_TOKEN ||= "123:test";
process.env.DATABASE_URL ||= "postgres://x/x";

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const req = createRequire(join(REPO, "app/"));

export async function bootApp({ persist, botFails } = {}) {
  const Fastify = (await import(join(REPO, "app/node_modules/fastify/fastify.js"))).default;

  const pg = persist ? new PGlite(join(REPO, "test/.pgdata")) : new PGlite();
  await pg.exec(readFileSync(join(REPO, "app/src/schema.sql"), "utf8"));

  const dbMod = req(join(REPO, "app/dist/db.js"));
  const q = (t, p) => pg.query(typeof t === "string" ? t : t.text, p || []);
  dbMod.pool.query = q;
  // pglite не держит транзакцию между отдельными .query() — BEGIN/COMMIT/ROLLBACK
  // делаем no-op: проверяем последовательность statements и итог, не атомарность.
  dbMod.pool.connect = async () => ({
    query: async (t, p) => {
      const sql = (typeof t === "string" ? t : t.text).trim().toUpperCase();
      return sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" ? { rows: [] } : q(t, p);
    },
    release: () => {},
  });

  const botMod = req(join(REPO, "app/dist/bot.js"));
  // без реальных вызовов Telegram; botFails => бот падает на любой вызов
  botMod.bot.api.config.use(() =>
    botFails
      ? Promise.reject(new Error("Forbidden: bot was blocked by the user"))
      : Promise.resolve({ ok: true, result: {} })
  );

  const { registerApi } = req(join(REPO, "app/dist/api.js"));
  // те же плагины/парсеры, что и на проде — из app/dist/index.js, без дублирования
  const { configureApp } = req(join(REPO, "app/dist/index.js"));

  const app = Fastify({ trustProxy: true, logger: false });
  await configureApp(app);
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));
  registerApi(app);
  await app.ready();
  return { app, pg };
}

// Подпись initData тем же алгоритмом Telegram (токен теста известен).
export async function signInitData(user, token = process.env.BOT_TOKEN) {
  const { default: crypto } = await import("crypto");
  const params = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAF",
  };
  const dcs = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}
