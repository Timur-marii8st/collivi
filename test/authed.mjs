// Полные сценарии с валидным initData и настоящим Postgres (pglite).
import { bootApp, signInitData } from "./_harness.mjs";

const { app, pg } = await bootApp();

const A = { id: 111, first_name: "Аня", username: "ann" };
const B = { id: 222, first_name: "Марк", username: "mark" };
const C = { id: 333, first_name: "Лена" };
const hA = await signInitData(A);
const hB = await signInitData(B);
const hC = await signInitData(C);

let fail = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fail++; };
const call = (h, method, url, payload) =>
  app.inject({ method, url, headers: { "x-init-data": h, "content-type": "application/json" }, payload });

const profile = (over = {}) => ({
  birthdate: "2000-05-10", gender: "m", prefer_gender: "any", occupation: "КФУ",
  budget_min: 12000, budget_max: 18000, districts: ["Приволжский"], move_in: "month",
  lease_months: 12, smoking: "no", alcohol: "sometimes", sleep_time: 0, cleanliness: 6,
  guests: "sometimes", parties: "no", pets_has: false, pets_ok: true, sociability: "medium",
  priorities: ["quiet", "clean"], interests: ["музыка", "кино"], ...over,
});

console.log("== POST /api/me: валидный initData сохраняет анкету ==");
{
  const r = await call(hA, "POST", "/api/me", profile());
  const me = r.json();
  r.statusCode === 200 && me.onboarded === true && me.budget_min === 12000 && me.first_name === "Аня"
    ? ok(`A сохранён: age=${me.age} onboarded=${me.onboarded} budget=${me.budget_min}-${me.budget_max}`)
    : bad(`A /api/me -> ${r.statusCode} ${JSON.stringify(me)}`);
}
console.log("== POST /api/me: невалидные данные -> 400 ==");
for (const [name, over] of [
  ["возраст <18", { birthdate: "2015-01-01" }],
  ["бюджет от>до", { budget_min: 20000, budget_max: 10000 }],
  ["мусорный enum", { gender: "helicopter" }],
]) {
  const r = await call(hB, "POST", "/api/me", profile(over));
  r.statusCode === 400 ? ok(`${name} -> 400 (${r.json().error})`) : bad(`${name} -> ${r.statusCode}`);
}

console.log("== заполняем B и C ==");
{
  const rb = await call(hB, "POST", "/api/me", profile({ budget_min: 13000, budget_max: 17000 }));
  const rc = await call(hC, "POST", "/api/me", profile({ budget_min: 40000, budget_max: 50000, districts: ["Кировский"] }));
  rb.statusCode === 200 && rc.statusCode === 200 ? ok("B и C сохранены") : bad(`B ${rb.statusCode} / C ${rc.statusCode}`);
}

console.log("== POST /api/candidates/preview ==");
{
  const r = await call(hA, "POST", "/api/candidates/preview", {
    birthdate: "2000-05-10", gender: "m", prefer_gender: "any",
    budget_min: 12000, budget_max: 18000, districts: ["Приволжский"], move_in: "month", lease_months: 12,
  });
  r.json().count === 1 ? ok("count = 1 (себя исключили, B подходит, C по бюджету — нет)") : bad(`count = ${r.json().count}`);
}

console.log("== GET /api/candidates: B, не C, с public_id ==");
{
  const cs = (await call(hA, "GET", "/api/candidates")).json().candidates;
  cs.length === 1 && cs[0].first_name === "Марк" && typeof cs[0].id === "string" && !("tg_id" in cs[0])
    ? ok(`кандидаты: [Марк] id=uuid score=${cs[0].score}`)
    : bad("candidates: " + JSON.stringify(cs));
  globalThis.__B = cs[0]?.id;
}

console.log("== POST /api/like: чужой / сам себя -> отказ ==");
{
  const r1 = await call(hA, "POST", "/api/like", { to: "00000000-0000-0000-0000-000000000000", like: true });
  const meId = (await pg.query("SELECT public_id FROM users WHERE tg_id=111")).rows[0].public_id;
  const r2 = await call(hA, "POST", "/api/like", { to: meId, like: true });
  r1.statusCode >= 400 && r2.statusCode === 400
    ? ok(`неизвестный -> ${r1.statusCode}, сам себя -> 400`)
    : bad(`-> ${r1.statusCode} / ${r2.statusCode}`);
}

console.log("== взаимный лайк A<->B -> mutual + /api/connections ==");
{
  await call(hA, "POST", "/api/like", { to: globalThis.__B, like: true });
  const aId = (await pg.query("SELECT public_id FROM users WHERE tg_id=111")).rows[0].public_id;
  const r2 = await call(hB, "POST", "/api/like", { to: aId, like: true });
  const list = (await call(hA, "GET", "/api/connections")).json().connections;
  r2.json().mutual === true && list.length === 1 && list[0].first_name === "Марк"
    ? ok(`mutual=true, connections=[Марк], id=${typeof list[0].id}`)
    : bad(`mutual ${JSON.stringify(r2.json())} / conn ${JSON.stringify(list)}`);
}

console.log("== POST /api/group/create: дубли убираются, транзакция ==");
{
  const r = await call(hA, "POST", "/api/group/create", { members: [globalThis.__B, globalThis.__B] });
  const gid = r.json().groupId;
  const m = (await pg.query("SELECT tg_id, ready FROM group_members WHERE group_id=$1 ORDER BY tg_id", [gid])).rows;
  m.length === 2 && m.some((x) => String(x.tg_id) === "111" && x.ready === true)
    ? ok(`группа #${gid}: участников 2 (дубль убран), создатель ready`)
    : bad("members: " + JSON.stringify(m));
  globalThis.__gid = gid;
}

console.log("== GET /api/group: ready = ready вызывающего, member.id = public_id ==");
{
  const ga = (await call(hA, "GET", "/api/group")).json();
  const gb = (await call(hB, "GET", "/api/group")).json();
  ga.ready === true && gb.ready === false && typeof ga.members[0].id === "string" && !("tg_id" in ga.members[0])
    ? ok(`A.ready=true, B.ready=false, member.id=public_id`)
    : bad(`A ${JSON.stringify(ga)} / B ${JSON.stringify(gb)}`);
}

console.log("== POST /api/group/confirm (B) -> статус confirmed ==");
{
  const r = await call(hB, "POST", "/api/group/confirm", {});
  const st = (await pg.query("SELECT status FROM groups WHERE id=$1", [globalThis.__gid])).rows[0]?.status;
  r.statusCode === 200 && st === "confirmed" ? ok("группа собрана") : bad(`-> ${r.statusCode}, статус ${st}`);
}

console.log("== POST /api/group/leave (B) -> распад при <2 ==");
{
  const r = await call(hB, "POST", "/api/group/leave", {});
  const g = (await pg.query("SELECT COUNT(*)::int c FROM groups WHERE id=$1", [globalThis.__gid])).rows[0].c;
  const m = (await pg.query("SELECT COUNT(*)::int c FROM group_members WHERE group_id=$1", [globalThis.__gid])).rows[0].c;
  r.statusCode === 200 && g === 0 && m === 0 ? ok("группа расформирована") : bad(`-> ${r.statusCode}, groups=${g}, members=${m}`);
}

console.log("== POST /api/apartments/:id/interest: кривой id -> 400 ==");
{
  const r = await call(hA, "POST", "/api/apartments/abc/interest", {});
  r.statusCode === 400 ? ok("400 на нечисловой id") : bad(`-> ${r.statusCode}`);
}

console.log(fail === 0 ? "\n✅ АУТЕНТИФИЦИРОВАННЫЕ РОУТЫ OK" : `\n❌ ПРОВАЛОВ: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
