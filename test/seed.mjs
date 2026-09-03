// Насыпать тестовых соседей в дев-базу (нужен запущенный test/dev-server.mjs).
//
//   node test/seed.mjs [твой_id]     по умолчанию 111 — тот, за кого ты в браузере
//
// Создаёт 3 совместимых анкеты. Если твоя анкета уже заполнена — они ещё и
// лайкают тебя, так что твой ответный лайк сразу даёт взаимный мэтч.
// Запускать можно повторно.
import crypto from "crypto";

const API = process.env.API || "http://localhost:3000";
const TOKEN = process.env.BOT_TOKEN || "123:test";
const ME = Number(process.argv[2]) || 111;

function sign(user) {
  const params = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAF-seed",
  };
  const dcs = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

async function api(initData, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", "x-init-data": initData },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const base = {
  gender: "m", prefer_gender: "any", occupation: "КФУ",
  budget_min: 12000, budget_max: 18000, districts: ["Приволжский"], move_in: "month",
  lease_months: 12, smoking: "no", alcohol: "sometimes", sleep_time: 0, cleanliness: 6,
  guests: "sometimes", parties: "no", pets_has: false, pets_ok: true, sociability: "medium",
  priorities: ["quiet", "clean"], interests: ["музыка", "кино"],
};

const people = [
  { id: 222, first_name: "Марк", username: "mark", over: { birthdate: "2001-03-14", cleanliness: 7 } },
  { id: 333, first_name: "Лена", username: "lena", over: { birthdate: "2002-07-20", gender: "f", interests: ["готовка", "чтение", "музыка"] } },
  { id: 444, first_name: "Дима", username: "dima", over: { birthdate: "1999-11-05", budget_min: 14000, budget_max: 19000, sociability: "high" } },
];

try {
  await fetch(API + "/api/health");
} catch {
  console.error(`Дев-сервер не отвечает на ${API}. Запусти:  node test/dev-server.mjs`);
  process.exit(1);
}

for (const p of people) {
  const h = sign({ id: p.id, first_name: p.first_name, username: p.username });
  await api(h, "POST", "/api/me", { ...base, ...p.over });
  console.log(`создан: ${p.first_name} (id ${p.id})`);
}

// если твоя анкета уже заполнена — пусть все трое тебя лайкнут
let mePub = null;
try {
  const me = await api(sign({ id: ME, first_name: "Ты" }), "GET", "/api/me");
  if (me && me.onboarded) mePub = me.public_id;
} catch {}

if (mePub) {
  for (const p of people) {
    const h = sign({ id: p.id, first_name: p.first_name, username: p.username });
    await api(h, "POST", "/api/like", { to: mePub, like: true }).catch((e) => console.warn(" лайк не прошёл:", e.message));
  }
  console.log(`\n${people.length} соседа лайкнули id ${ME}. Открой мини-апп, лайкни любого — сразу взаимный мэтч.`);
} else {
  console.log(`\nАнкета id ${ME} ещё не заполнена. Пройди её в браузере и запусти этот скрипт ещё раз —\nтогда соседи тебя лайкнут и будет мэтч.`);
}
