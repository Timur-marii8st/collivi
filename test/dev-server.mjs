// Дев-сервер API на встроенном Postgres (pglite, WASM) — без Docker и без бота.
//
//   node test/dev-server.mjs            # старт, данные сохраняются в test/.pgdata
//   FRESH=1 node test/dev-server.mjs    # старт с чистой базой (сброс профилей)
//   SKIP_BUILD=1 node test/dev-server.mjs   # не пересобирать app/dist
//
// Сам пересобирает app/dist перед стартом, чтобы не подхватить старый код.
// vite проксирует /api -> :3000 (см. webapp/vite.config.ts).
import { execSync } from "child_process";
import { rmSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const PORT = Number(process.env.PORT) || 3000;

if (process.env.FRESH === "1") {
  rmSync(join(HERE, ".pgdata"), { recursive: true, force: true });
  console.log("FRESH=1 — база очищена");
}

if (process.env.SKIP_BUILD !== "1") {
  console.log("сборка app/dist…");
  execSync("npm run build", { cwd: join(REPO, "app"), stdio: "inherit" });
}

const { bootApp } = await import("./_harness.mjs");
const { app } = await bootApp({ persist: true });

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`dev API (pglite) → http://localhost:${PORT}`);
console.log(`initData для мини-аппа: node test/sign.mjs 111 Аня @ann`);
console.log(`сброс данных: перезапусти c FRESH=1`);
