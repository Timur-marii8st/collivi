// Схема БД и ключевые SQL-запросы на настоящем Postgres (pglite, WASM — Docker не нужен).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const schema = readFileSync(join(REPO, "app/src/schema.sql"), "utf8");

const db = new PGlite();
let fail = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fail++; };

console.log("== 1. schema.sql применяется ==");
try {
  await db.exec(schema);
  ok("schema.sql выполнился без ошибок");
} catch (e) {
  bad("schema.sql: " + e.message);
  process.exit(1);
}

console.log("== 2. schema.sql идемпотентен (повторный запуск) ==");
try {
  await db.exec(schema);
  ok("повторный запуск без ошибок");
} catch (e) {
  bad("повторный запуск: " + e.message);
}

console.log("== 3. колонки на месте ==");
const cols = (await db.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='users'`
)).rows.map((r) => r.column_name);
for (const c of ["birthdate", "budget_min", "budget_max", "priorities", "public_id", "age", "budget", "lease_months"])
  cols.includes(c) ? ok("users." + c) : bad("нет users." + c);

console.log("== 4. внешние ключи создались ==");
const fks = (await db.query(`SELECT conname FROM pg_constraint WHERE contype='f'`)).rows;
fks.length >= 8 ? ok(`FK: ${fks.length} шт`) : bad(`FK всего ${fks.length}, ждали >=8`);

console.log("== 5. CHECK возраст 18+ ==");
try {
  await db.query(`INSERT INTO users (tg_id, public_id, age) VALUES (1, gen_random_uuid(), 15)`);
  bad("age=15 прошёл — CHECK не работает");
} catch {
  ok("age=15 отклонён");
}

console.log("== 6. INSERT + ON CONFLICT (как в POST /api/me) не затирает имя ==");
const onConflict = `
  INSERT INTO users (tg_id, username, first_name) VALUES ($1,$2,$3)
  ON CONFLICT (tg_id) DO UPDATE SET
    username = COALESCE(EXCLUDED.username, users.username),
    first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
    updated_at = NOW()`;
await db.query(onConflict, ["777", "ann", "Аня"]);
await db.query(onConflict, ["777", null, ""]);
const r6 = (await db.query(`SELECT username, first_name FROM users WHERE tg_id=777`)).rows[0];
r6.username === "ann" && r6.first_name === "Аня"
  ? ok("имя/username сохранены при пустом апдейте")
  : bad("затёрло: " + JSON.stringify(r6));

console.log("== 7. динамический UPDATE анкеты (как в POST /api/me) ==");
{
  const patch = { age: 24, gender: "m", budget: 18000, budget_min: 12000, budget_max: 18000, districts: ["Приволжский"], priorities: ["quiet", "clean"], lease_months: null };
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const params = keys.map((k) => patch[k]);
  sets.push("onboarded = TRUE", "updated_at = NOW()");
  params.push("777");
  await db.query(`UPDATE users SET ${sets.join(", ")} WHERE tg_id = $${params.length}`, params);
  const u = (await db.query(`SELECT age, budget_min, priorities, lease_months, onboarded FROM users WHERE tg_id=777`)).rows[0];
  u.age === 24 && u.budget_min === 12000 && u.onboarded === true && u.lease_months === null
    ? ok("UPDATE прошёл: " + JSON.stringify(u))
    : bad("UPDATE неверно: " + JSON.stringify(u));
}

console.log("== 8. FK-каскад при DELETE users (как в /delete_me) ==");
await db.query(`INSERT INTO users (tg_id, public_id, first_name) VALUES (888, gen_random_uuid(), 'Б')`);
await db.query(`INSERT INTO likes (from_tg, to_tg) VALUES (777, 888), (888, 777)`);
await db.query(`DELETE FROM users WHERE tg_id = 888`);
(await db.query(`SELECT COUNT(*)::int c FROM likes`)).rows[0].c === 0
  ? ok("лайки удалились каскадом") : bad("лайки остались");

console.log("== 9. запрос /api/connections (взаимные лайки, public_id) ==");
await db.query(`INSERT INTO users (tg_id, public_id, first_name, age, occupation, budget, onboarded, status) VALUES (999, gen_random_uuid(), 'Марк', 25, 'КФУ', 17000, true, 'active')`);
await db.query(`INSERT INTO likes (from_tg, to_tg) VALUES (777, 999), (999, 777)`);
{
  const rows = (await db.query(
    `SELECT u.public_id AS id, u.first_name FROM likes a
     JOIN likes b ON a.from_tg=b.to_tg AND a.to_tg=b.from_tg
     JOIN users u ON u.tg_id = a.to_tg WHERE a.from_tg = $1`,
    ["777"]
  )).rows;
  rows.length === 1 && rows[0].first_name === "Марк" && typeof rows[0].id === "string"
    ? ok("взаимный лайк с public_id: " + JSON.stringify(rows[0]))
    : bad("connections: " + JSON.stringify(rows));
}

console.log("== 10. /api/group/leave: SELECT списка участников без ambiguous ==");
await db.query(`INSERT INTO groups (id, status) VALUES (1, 'forming')`);
await db.query(`INSERT INTO group_members (group_id, tg_id) VALUES (1, 777), (1, 999)`);
try {
  const rest = (await db.query(`SELECT tg_id FROM group_members WHERE group_id=$1`, [1])).rows;
  rest.length === 2 ? ok("список участников читается (tg_id не ambiguous)") : bad("rest: " + JSON.stringify(rest));
} catch (e) {
  bad("leave SELECT: " + e.message);
}

console.log("== 11. GET /api/apartments — явные колонки, без contact ==");
await db.query(`INSERT INTO apartments (id, title, rooms, price, contact, created_by) VALUES (1,'Трёшка',3,45000,'+7999','12345')`);
{
  const rows = (await db.query(
    `SELECT id, title, rooms, price, district, address, isolated_rooms, photo_id, status
     FROM apartments WHERE status='available' AND price / GREATEST(rooms, 1) <= $1 + 3000`,
    [17000]
  )).rows;
  rows.length === 1 && !("contact" in rows[0]) && !("created_by" in rows[0])
    ? ok("без contact/created_by: " + Object.keys(rows[0]).join(","))
    : bad("apartments: " + JSON.stringify(rows[0]));
}

console.log(fail === 0 ? "\n✅ ВСЕ ПРОВЕРКИ ПРОШЛИ" : `\n❌ ПРОВАЛОВ: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
