import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { join } from "path";
import { initDb } from "./db";
import { registerApi } from "./api";
import { startBot } from "./bot";
import { PORT, WEBAPP_URL, NODE_ENV, assertConfig } from "./config";

/**
 * Плагины и парсеры, общие для прода и локального дев-сервера (test/_harness.mjs
 * подключает эту же функцию, чтобы не расходиться с продом). Статику и 404
 * добавляет только main().
 */
export async function configureApp(app: FastifyInstance) {
  // POST без тела (confirm / leave) не должен падать из-за
  // Content-Type: application/json — пустое тело трактуем как {}.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const s = (body as string).trim();
      if (!s) return done(null, {});
      try {
        done(null, JSON.parse(s));
      } catch (err) {
        (err as any).statusCode = 400;
        done(err as Error, undefined);
      }
    }
  );

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
}

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

  await configureApp(app);

  await app.register(fastifyStatic, {
    root: join(__dirname, "..", "public"),
    prefix: "/",
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));

  registerApi(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`API + webapp on :${PORT}`);

  if (process.env.DISABLE_BOT === "1") {
    console.warn("DISABLE_BOT=1 — бот не запускается, только API + webapp");
    return;
  }
  startBot().catch((e) => {
    console.error("Bot failed:", e);
    process.exit(1);
  });
}

if (require.main === module) main();
