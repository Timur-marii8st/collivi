import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "path";
import { initDb } from "./db";
import { registerApi } from "./api";
import { startBot } from "./bot";
import { PORT, WEBAPP_URL, ADMIN_IDS } from "./config";

async function main() {
  await initDb();
  console.log("DB ready");

  const app = Fastify({ logger: false });
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
}

main();
