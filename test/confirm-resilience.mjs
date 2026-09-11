// Если бот не может доставить сообщение (пользователь заблокировал бота, неверный
// токен, сеть) — /api/group/confirm и /api/group/leave всё равно отрабатывают,
// а не падают с 500.
import { bootApp, signInitData } from "./_harness.mjs";

const { app, pg } = await bootApp({ botFails: true });

let fail = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fail++; };
const call = (h, m, url, b) =>
  app.inject({ method: m, url, headers: { "x-init-data": h, "content-type": "application/json" }, payload: b });

const base = {
  gender: "m", prefer_gender: "any", occupation: "КГМУ",
  budget_min: 10000, budget_max: 10000, districts: ["Приволжский"], move_in: "month",
  lease_months: 12, smoking: "no", alcohol: "no", sleep_time: 0, cleanliness: 6,
  guests: "sometimes", parties: "no", pets_has: false, pets_ok: true, sociability: "medium",
  priorities: ["quiet"], interests: ["музыка"],
};

const hA = await signInitData({ id: 1, first_name: "Марк" });
const hB = await signInitData({ id: 2, first_name: "Аня" });
await call(hA, "POST", "/api/me", { ...base, birthdate: "2001-01-01" });
await call(hB, "POST", "/api/me", { ...base, birthdate: "2001-02-02" });
const pub = async (h) => (await call(h, "GET", "/api/me")).json().public_id;
const pA = await pub(hA), pB = await pub(hB);
await call(hA, "POST", "/api/like", { to: pB, like: true });
await call(hB, "POST", "/api/like", { to: pA, like: true });
const gid = (await call(hA, "POST", "/api/group/create", { members: [pB] })).json().groupId;

console.log("== /api/group/confirm при падающем боте ==");
{
  const r = await call(hB, "POST", "/api/group/confirm", {});
  const st = (await pg.query("SELECT status FROM groups WHERE id=$1", [gid])).rows[0]?.status;
  r.statusCode === 200 && st === "confirmed"
    ? ok("200, группа собрана (уведомления — best-effort)")
    : bad(`-> ${r.statusCode} ${r.body}, статус ${st}`);
}

console.log("== /api/group/leave при падающем боте ==");
{
  const r = await call(hB, "POST", "/api/group/leave", {});
  r.statusCode === 200 ? ok("200") : bad(`-> ${r.statusCode} ${r.body}`);
}

console.log(fail === 0 ? "\n✅ УСТОЙЧИВОСТЬ К СБОЮ БОТА OK" : `\n❌ ПРОВАЛОВ: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
