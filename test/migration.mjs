// Проверяет реальный upgrade: схема текущего main (без FK) -> новая schema.sql.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const legacy = readFileSync(join(REPO, "test/legacy-main-schema.sql"), "utf8");
const current = readFileSync(join(REPO, "app/src/schema.sql"), "utf8");

const db = new PGlite();
let fail = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fail++; };

console.log("== legacy main schema ==");
try {
  await db.exec(legacy);
  ok("старая схема поднялась");
} catch (e) {
  bad("legacy schema: " + e.message);
  process.exit(1);
}

// Валидные и намеренно orphan-строки — старая схема это разрешала.
await db.query("INSERT INTO users (tg_id, first_name, status, onboarded) VALUES (1,'A','active',true),(2,'B','active',true)");
await db.query("INSERT INTO groups (id, status) VALUES (1,'forming'),(2,'forming')");
await db.query("INSERT INTO apartments (id,title,rooms,price,status) VALUES (1,'Apt',2,30000,'available')");
await db.query("INSERT INTO likes (from_tg,to_tg) VALUES (1,2),(1,999)");
await db.query("INSERT INTO dislikes (from_tg,to_tg) VALUES (2,1),(999,1)");
await db.query("INSERT INTO group_members (group_id,tg_id) VALUES (1,1),(999,1),(2,999)");
await db.query("INSERT INTO apt_interest (apt_id,group_id,tg_id) VALUES (1,1,1),(999,1,2),(1,999,2),(1,1,999)");

console.log("== apply current schema as migration ==");
try {
  await db.exec(current);
  ok("новая schema.sql применилась поверх старой");
} catch (e) {
  bad("migration: " + e.message);
  process.exit(1);
}

console.log("== orphan cleanup ==");
const orphanChecks = [
  ["likes", "SELECT COUNT(*)::int c FROM likes WHERE from_tg NOT IN (SELECT tg_id FROM users) OR to_tg NOT IN (SELECT tg_id FROM users)"],
  ["dislikes", "SELECT COUNT(*)::int c FROM dislikes WHERE from_tg NOT IN (SELECT tg_id FROM users) OR to_tg NOT IN (SELECT tg_id FROM users)"],
  ["group_members", "SELECT COUNT(*)::int c FROM group_members WHERE group_id NOT IN (SELECT id FROM groups) OR tg_id NOT IN (SELECT tg_id FROM users)"],
  ["apt_interest", "SELECT COUNT(*)::int c FROM apt_interest WHERE apt_id NOT IN (SELECT id FROM apartments) OR group_id NOT IN (SELECT id FROM groups) OR tg_id NOT IN (SELECT tg_id FROM users)"],
];
for (const [name, sql] of orphanChecks) {
  const n = (await db.query(sql)).rows[0].c;
  n === 0 ? ok(name + ": orphan rows удалены") : bad(name + ": orphan rows=" + n);
}

console.log("== cascading foreign keys ==");
const expected = [
  "likes_from_tg_fkey", "likes_to_tg_fkey",
  "dislikes_from_tg_fkey", "dislikes_to_tg_fkey",
  "group_members_group_id_fkey", "group_members_tg_id_fkey",
  "apt_interest_apt_id_fkey", "apt_interest_group_id_fkey", "apt_interest_tg_id_fkey",
];
const fkRows = (await db.query("SELECT conname FROM pg_constraint WHERE contype='f'")).rows.map((r) => r.conname);
for (const name of expected)
  fkRows.includes(name) ? ok(name) : bad("нет FK " + name);

console.log("== DELETE user cascades legacy relations ==");
await db.query("INSERT INTO likes (from_tg,to_tg) VALUES (2,1) ON CONFLICT DO NOTHING");
await db.query("INSERT INTO group_members (group_id,tg_id) VALUES (1,2) ON CONFLICT DO NOTHING");
await db.query("DELETE FROM users WHERE tg_id=2");
const userRefs = (
  (await db.query("SELECT COUNT(*)::int c FROM likes WHERE from_tg=2 OR to_tg=2")).rows[0].c +
  (await db.query("SELECT COUNT(*)::int c FROM dislikes WHERE from_tg=2 OR to_tg=2")).rows[0].c +
  (await db.query("SELECT COUNT(*)::int c FROM group_members WHERE tg_id=2")).rows[0].c +
  (await db.query("SELECT COUNT(*)::int c FROM apt_interest WHERE tg_id=2")).rows[0].c
);
userRefs === 0 ? ok("user cascade работает") : bad("после DELETE user осталось ссылок: " + userRefs);

console.log("== DELETE group cascades memberships/interests ==");
await db.query("INSERT INTO group_members (group_id,tg_id) VALUES (2,1) ON CONFLICT DO NOTHING");
await db.query("INSERT INTO apt_interest (apt_id,group_id,tg_id) VALUES (1,2,1) ON CONFLICT DO NOTHING");
await db.query("DELETE FROM groups WHERE id=2");
const groupRefs =
  (await db.query("SELECT COUNT(*)::int c FROM group_members WHERE group_id=2")).rows[0].c +
  (await db.query("SELECT COUNT(*)::int c FROM apt_interest WHERE group_id=2")).rows[0].c;
groupRefs === 0 ? ok("group cascade работает") : bad("после DELETE group осталось ссылок: " + groupRefs);

console.log(fail === 0 ? "\n✅ MIGRATION main -> PR OK" : `\n❌ ПРОВАЛОВ: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
