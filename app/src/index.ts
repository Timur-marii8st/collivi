import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "path";
import { initDb, pool } from "./db";
import { registerApi } from "./api";
import { startBot, bot } from "./bot";
import { PORT, WEBAPP_URL, ADMIN_IDS } from "./config";

async function main() {
  await initDb();
  console.log("DB ready");

  const app = Fastify({ logger: { level: "error" } });
  await app.register(fastifyStatic, {
    root: join(__dirname, "..", "public"),
    prefix: "/",
  });
  registerApi(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`API + webapp on :${PORT}`);

  if (!WEBAPP_URL) console.warn("WEBAPP_URL не задан!");
  if (!ADMIN_IDS.length) console.warn("ADMIN_IDS не задан — админка выключена");

  startBot().catch((e) => {
    console.error("Bot failed:", e);
    process.exit(1);
  });

  // graceful shutdown: при деплое/перезапуске контейнер должен отдавать
  // текущие запросы и закрывать пул БД, а не падать по таймауту SIGKILL
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down…`);
    try {
      await bot.stop();
    } catch (e) {
      console.error("bot.stop:", e);
    }
    try {
      await app.close();
    } catch (e) {
      console.error("app.close:", e);
    }
    try {
      await pool.end();
    } catch (e) {
      console.error("pool.end:", e);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main();
