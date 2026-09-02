// Запускается внутри контейнера svoi-app: docker exec -i svoi-app-1 node < ops/check-bot-meta.js
// Печатает только ответы Telegram API, токен не выводится.
const https = require("https");
const { HttpsProxyAgent } = require("https-proxy-agent");

const token = process.env.BOT_TOKEN;
const proxy = process.env.TG_PROXY;

function call(method) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.telegram.org/bot${token}/${method}`,
      proxy ? { agent: new HttpsProxyAgent(proxy) } : {},
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      }
    );
    req.on("error", (e) => resolve("ERR " + e.message));
    req.setTimeout(20000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

(async () => {
  for (const m of ["getMyCommands", "getMyDescription", "getChatMenuButton"]) {
    const r = await call(m);
    console.log(m + ": " + String(r).slice(0, 300));
  }
})();
