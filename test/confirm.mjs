// Подтвердить участие в группе за тестовых соседей (222 Марк, 333 Лена, 444 Дима).
// Нужен запущенный test/dev-server.mjs. Когда все участники подтвердили —
// группа переходит в «собрана» и открывается вкладка «Квартиры».
//
//   node test/confirm.mjs
import crypto from "crypto";

const API = process.env.API || "http://localhost:3000";
const TOKEN = process.env.BOT_TOKEN || "123:test";

function sign(user) {
  const params = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAF-confirm",
  };
  const dcs = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

const people = [
  { id: 222, first_name: "Марк" },
  { id: 333, first_name: "Лена" },
  { id: 444, first_name: "Дима" },
];

try {
  await fetch(API + "/api/health");
} catch {
  console.error(`Дев-сервер не отвечает на ${API}. Запусти:  node test/dev-server.mjs`);
  process.exit(1);
}

for (const p of people) {
  const r = await fetch(API + "/api/group/confirm", {
    method: "POST",
    headers: { "x-init-data": sign(p) },
  });
  const body = await r.text();
  if (r.ok) console.log(`${p.first_name}: подтвердил(а)`);
  else console.log(`${p.first_name}: ${r.status} ${body}`); // 404 = не в этой группе, это ок
}

console.log("\nОбнови мини-апп: если все участники группы подтвердили — «Группа собрана», вкладка «Квартиры».");
