// Дев-сервер API на встроенном Postgres (pglite, WASM) — без Docker и без бота.
// Данные лежат в test/.pgdata и переживают перезапуск.
//
//   npm --prefix app run build
//   npm --prefix test install
//   node test/dev-server.mjs               # API на :3000
//   cd webapp && VITE_DEV_INITDATA="$(node ../test/sign.mjs 111 Аня)" npm run dev
//
// vite проксирует /api -> :3000 (см. webapp/vite.config.ts).
import { bootApp } from "./_harness.mjs";

const PORT = Number(process.env.PORT) || 3000;
const { app } = await bootApp({ persist: true });

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`dev API (pglite) → http://localhost:${PORT}`);
console.log(`initData для мини-аппа: node test/sign.mjs 111 Аня @ann`);
console.log(`сброс данных: rm -rf test/.pgdata`);
