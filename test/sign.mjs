// Печатает валидный initData (подписанный тем же алгоритмом Telegram) — для
// локального теста мини-аппа и запросов к API без реального Telegram.
//
//   node test/sign.mjs [userId] [Имя] [@username]
//
// BOT_TOKEN берётся из окружения, по умолчанию "123:test" (как у дев-сервера).
// Токен должен совпадать с тем, что у бэкенда, иначе валидация не пройдёт.
import crypto from "crypto";

const TOKEN = process.env.BOT_TOKEN || "123:test";
const [, , idArg, nameArg, userArg] = process.argv;

const user = {
  id: Number(idArg) || 111,
  first_name: nameArg || "Тест",
  ...(userArg ? { username: userArg.replace(/^@/, "") } : {}),
};

const params = {
  user: JSON.stringify(user),
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "AAF-test",
};
const dcs = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
const hash = crypto.createHmac("sha256", secret).update(dcs).digest("hex");

process.stdout.write(new URLSearchParams({ ...params, hash }).toString());
