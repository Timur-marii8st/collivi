import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { join } from "path";
import { initDb } from "./db";
import { registerApi } from "./api";
import { startBot } from "./bot";
import { PORT, WEBAPP_URL, NODE_ENV, assertConfig } from "./config";

async function main() {
  assertConfig();

  await initDb();
  console.log("DB ready");

  const app = Fastify({
    trustProxy: true, // за Caddy — иначе rate-limit ключуется по IP прокси
    logger: {
      level: NODE_ENV === "production" ? "info" : "warn",
      redact: ['req.headers["x-init-data"]', "req.headers.authorization"],
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://telegram.org"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: WEBAPP_URL ? [WEBAPP_URL] : false,
    methods: ["GET", "POST"],
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/api/health",
  });

  await app.register(fastifyStatic, {
    root: join(__dirname, "..", "public"),
    prefix: "/",
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));

  registerApi(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`API + webapp on :${PORT}`);

  startBot().catch((e) => {
    console.error("Bot failed:", e);
    process.exit(1);
  });
}

main();
