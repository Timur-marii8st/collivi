// Бэкенд поднимается со всеми плагинами, публичные роуты и auth отвечают верно.
import { bootApp } from "./_harness.mjs";

const { app } = await bootApp();
let fail = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fail++; };
const inj = (o) => app.inject(o);

ok("плагины (helmet/cors/rate-limit) зарегистрированы, роуты собрались");

{
  const r = await inj({ method: "GET", url: "/api/health" });
  r.statusCode === 200 && r.json().ok === true ? ok("/api/health -> 200 {ok:true}") : bad(`health -> ${r.statusCode}`);
}
{
  const r = await inj({ method: "GET", url: "/api/me" });
  r.statusCode === 401 ? ok("/api/me без initData -> 401") : bad(`-> ${r.statusCode}`);
}
{
  const r = await inj({ method: "POST", url: "/api/candidates/preview", payload: {} });
  r.statusCode === 401 ? ok("/api/candidates/preview без initData -> 401") : bad(`-> ${r.statusCode}`);
}
{
  const h = (await inj({ method: "GET", url: "/api/health" })).headers;
  h["x-content-type-options"] === "nosniff" ? ok("X-Content-Type-Options: nosniff") : bad("нет nosniff");
  h["strict-transport-security"] ? ok("HSTS присутствует") : bad("нет HSTS");
  (h["content-security-policy"] || "").includes("frame-ancestors") ? ok("CSP frame-ancestors") : bad("нет frame-ancestors");
}
{
  const r = await inj({ method: "GET", url: "/nope-nope" });
  r.statusCode === 404 && !r.body.includes("Route GET") ? ok("404 без сигнатуры Fastify") : bad(`-> ${r.statusCode} ${r.body}`);
}
{
  const r = await inj({
    method: "GET", url: "/api/me",
    headers: { "x-init-data": "user=%7B%22id%22%3A1%7D&auth_date=9999999999&hash=deadbeef" },
  });
  r.statusCode === 401 ? ok("поддельный initData -> 401") : bad(`-> ${r.statusCode}`);
}

console.log(fail === 0 ? "\n✅ BOOT + РОУТЫ OK" : `\n❌ ПРОВАЛОВ: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
