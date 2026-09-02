import { Bot, Context, session, SessionFlavor } from "grammy";
import { BOT_TOKEN, ADMIN_IDS, WEBAPP_URL, TG_PROXY } from "./config";
import { pool } from "./db";
import { openAppKeyboard, sendWithFloodRetry, sleep } from "./notify";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HttpsProxyAgent } = require("https-proxy-agent");

interface SessionData {
  adminFlow?: string;
  aptDraft?: Record<string, any>;
}
type MyCtx = Context & SessionFlavor<SessionData>;

export const bot = new Bot<MyCtx>(
  BOT_TOKEN,
  TG_PROXY
    ? { client: { baseFetchConfig: { agent: new HttpsProxyAgent(TG_PROXY) as never } } }
    : {}
);
bot.use(session({ initial: (): SessionData => ({}) }));

if (!ADMIN_IDS.length) {
  bot.on("message", (ctx) =>
    console.log(`[SETUP] Чтобы включить админку, добавь в ADMIN_IDS: ${ctx.from?.id}`)
  );
}

export function isAdmin(ctx: MyCtx): boolean {
  return ADMIN_IDS.includes(ctx.from?.id || 0);
}

/**
 * Ответ обычному пользователю на любое сообщение: раньше бот молчал,
 * хотя в профиле написано «напиши нам в боте». Текст пересылаем админам.
 */
async function userSupportReply(ctx: MyCtx) {
  await ctx.reply(
    "Привет! Я бот сервиса «Свои» 🏠\n" +
      "Изменить анкету, смотреть соседей и квартиры можно в приложении — кнопка ниже.\n" +
      "Сообщение передали команде, ответим здесь в чате.",
    { reply_markup: openAppKeyboard() }
  );
  for (const id of ADMIN_IDS) await ctx.forwardMessage(id).catch(() => {});
}

// ---------- пользовательские команды ----------

bot.command("start", async (ctx) => {
  await ctx.reply(
    `👋 Привет, ${ctx.from?.first_name || ""}!\n\n` +
      `Я помогаю находить *соседей под тебя* и снимать большую квартиру вместе — ` +
      `отдельная комната по цене комнаты в коммуналке, но с людьми, которые совпадают с тобой по образу жизни.\n\n` +
      `1️⃣ Заполни короткую анкету (3 минуты)\n` +
      `2️⃣ Смотри карточки совместимых соседей\n` +
      `3️⃣ Соберите группу из 3–4 человек\n` +
      `4️⃣ Получите подборку квартир под ваш бюджет\n\n` +
      `Жми кнопку ниже 👇`,
    { parse_mode: "Markdown", reply_markup: openAppKeyboard("Заполнить анкету") }
  );
});

bot.command("profile", async (ctx) => {
  const { rows } = await pool.query(
    "SELECT onboarded FROM users WHERE tg_id=$1",
    [ctx.from!.id]
  );
  const filled = rows[0]?.onboarded;
  await ctx.reply(
    filled
      ? "Твоя анкета заполнена ✅ Можешь посмотреть её в приложении."
      : "Анкета ещё не заполнена 📝",
    { reply_markup: openAppKeyboard(filled ? "Открыть профиль" : "Заполнить анкету") }
  );
});

// ---------- подтверждение группы из бота ----------

bot.callbackQuery(/^grp_yes:(\d+)$/, async (ctx) => {
  const groupId = parseInt(ctx.match[1], 10);
  await pool.query(
    "UPDATE group_members SET ready=TRUE WHERE group_id=$1 AND tg_id=$2",
    [groupId, ctx.from!.id]
  );
  await ctx.answerCallbackQuery({ text: "Принято! 🎉" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  await checkGroupComplete(groupId);
});

bot.callbackQuery(/^grp_no:(\d+)$/, async (ctx) => {
  const groupId = parseInt(ctx.match[1], 10);
  await pool.query("DELETE FROM group_members WHERE group_id=$1 AND tg_id=$2", [
    groupId,
    ctx.from!.id,
  ]);
  await pool.query("UPDATE users SET status='active' WHERE tg_id=$1", [
    ctx.from!.id,
  ]);
  // если остался один — расформировать и снять статус с оставшегося
  const { rows } = await pool.query(
    "SELECT tg_id FROM group_members WHERE group_id=$1",
    [groupId]
  );
  if (rows.length < 2) {
    await pool.query("DELETE FROM apt_interest WHERE group_id=$1", [groupId]);
    await pool.query("DELETE FROM group_members WHERE group_id=$1", [groupId]);
    await pool.query("DELETE FROM groups WHERE id=$1", [groupId]);
    if (rows.length === 1)
      await pool.query("UPDATE users SET status='active' WHERE tg_id=$1", [
        rows[0].tg_id,
      ]);
  }
  await ctx.answerCallbackQuery({ text: "Ок, без обид 🙂" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
});

export async function checkGroupComplete(groupId: number) {
  const { rows } = await pool.query(
    `SELECT gm.tg_id, gm.ready, u.first_name, u.budget
     FROM group_members gm JOIN users u ON u.tg_id=gm.tg_id
     WHERE gm.group_id=$1`,
    [groupId]
  );
  if (!rows.length || rows.some((r) => !r.ready)) return;
  await pool.query("UPDATE groups SET status='confirmed' WHERE id=$1", [groupId]);
  for (const r of rows)
    await pool.query("UPDATE users SET status='in_group' WHERE tg_id=$1", [r.tg_id]);

  const members = rows.map((r) => ({ tg_id: String(r.tg_id), first_name: r.first_name }));
  const totalBudget = rows.reduce((s, r) => s + (r.budget || 0), 0);

  const { notifyGroupConfirmed } = await import("./notify");
  await notifyGroupConfirmed(bot, members, totalBudget);

  for (const adminId of ADMIN_IDS) {
    const list = members
      .map((m) => `• [${m.first_name}](tg://user?id=${m.tg_id})`)
      .join("\n");
    await bot.api
      .sendMessage(
        adminId,
        `✅ *Сформирована группа #${groupId}*\n${list}\nОбщий бюджет: ${totalBudget.toLocaleString("ru-RU")} ₽`,
        { parse_mode: "Markdown" }
      )
      .catch(() => {});
  }
}

// ---------- админка ----------

async function adminMenu(ctx: MyCtx) {
  await ctx.reply("⚙️ Админ-панель", {
    reply_markup: {
      inline_keyboard: [
        ...(WEBAPP_URL
          ? [[{ text: "🖥 Панель управления", web_app: { url: WEBAPP_URL } }]]
          : []),
        [
          { text: "📊 Статистика", callback_data: "adm_stats" },
          { text: "👥 Анкеты", callback_data: "adm_users" },
        ],
        [
          { text: "🏠 Добавить квартиру", callback_data: "adm_apt_new" },
          { text: "📋 Квартиры", callback_data: "adm_apts" },
        ],
        [{ text: "📣 Рассылка", callback_data: "adm_broadcast" }],
      ],
    },
  });
}

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await adminMenu(ctx);
});

const DISTRICTS = [
  "Вахитовский", "Советский", "Приволжский", "Авиастроительный",
  "Ново-Савиновский", "Московский", "Кировский", "Любой",
];

bot.callbackQuery("adm_stats", async (ctx) => {
  const u = await pool.query("SELECT COUNT(*)::int n FROM users WHERE onboarded");
  const g = await pool.query("SELECT COUNT(*)::int n FROM groups");
  const gc = await pool.query(
    "SELECT COUNT(*)::int n FROM groups WHERE status='confirmed'"
  );
  const a = await pool.query("SELECT COUNT(*)::int n FROM apartments");
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `📊 *Статистика*\n\nАнкет заполнено: ${u.rows[0].n}\nГрупп всего: ${g.rows[0].n}\nГрупп подтверждено: ${gc.rows[0].n}\nКвартир в базе: ${a.rows[0].n}`,
    { parse_mode: "Markdown" }
  );
});

bot.callbackQuery("adm_users", async (ctx) => {
  const { rows } = await pool.query(
    `SELECT first_name, username, age, budget, districts, occupation
     FROM users WHERE onboarded ORDER BY updated_at DESC LIMIT 10`
  );
  await ctx.answerCallbackQuery();
  const text =
    rows
      .map(
        (r) =>
          `👤 *${r.first_name}* ${r.age ? `(${r.age})` : ""}${r.username ? ` @${r.username}` : ""}\n` +
          `${r.occupation || "—"} · ${r.budget ? r.budget.toLocaleString("ru-RU") + " ₽" : "—"} · ${(r.districts || []).join(", ") || "—"}`
      )
      .join("\n\n") || "Пока нет анкет";
  await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.callbackQuery("adm_apts", async (ctx) => {
  const { rows } = await pool.query(
    "SELECT * FROM apartments ORDER BY created_at DESC LIMIT 10"
  );
  await ctx.answerCallbackQuery();
  const text =
    rows
      .map(
        (a) =>
          `🏠 *${a.title}*\n${a.rooms}-комн · ${a.district} · ${a.price.toLocaleString("ru-RU")} ₽ (~${Math.ceil(a.price / a.rooms).toLocaleString("ru-RU")} ₽/чел)\n${a.address || ""} · статус: ${a.status}`
      )
      .join("\n\n") || "Квартир пока нет";
  await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.callbackQuery("adm_apt_new", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = "apt_title";
  ctx.session.aptDraft = {};
  await ctx.reply("🏠 Название квартиры (напр. «Трёшка у парка Горького»):");
});

bot.callbackQuery("adm_broadcast", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = "broadcast";
  await ctx.reply("📣 Пришли сообщение для рассылки. Отменить: /cancel");
});

bot.command("cancel", async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.adminFlow = undefined;
  ctx.session.aptDraft = undefined;
  await ctx.reply("Отменено.");
});

async function offerAptToGroups(ctx: MyCtx, aptId: number) {
  const apt = (
    await pool.query("SELECT * FROM apartments WHERE id=$1", [aptId])
  ).rows[0];
  const perPerson = Math.ceil(apt.price / apt.rooms);
  const groups = (
    await pool.query(
      `SELECT g.id, COALESCE(SUM(u.budget),0) budget, MIN(u.budget) minb,
              STRING_AGG(u.first_name, ', ') names
       FROM groups g JOIN group_members gm ON gm.group_id=g.id JOIN users u ON u.tg_id=gm.tg_id
       WHERE g.status='confirmed' GROUP BY g.id HAVING COUNT(*) >= $1`,
      [apt.rooms]
    )
  ).rows;
  if (!groups.length) {
    await ctx.reply("Подходящих групп нет.");
    return;
  }
  const suitable = groups.filter((g) => perPerson <= (Number(g.minb) || 0) + 3000);
  if (!suitable.length) {
    await ctx.reply(`Группы есть (${groups.length}), но бюджет не подходит.`);
  }
  await ctx.reply("Отправить эту квартиру подходящим группам?", {
    reply_markup: {
      inline_keyboard: [
        ...suitable.map((g) => [
          {
            text: `#${g.id}: ${g.names} (${Math.floor(g.budget).toLocaleString("ru-RU")} ₽)`,
            callback_data: `apt_push:${aptId}:${g.id}`,
          },
        ]),
      ],
    },
  });
}

bot.callbackQuery(/^apt_push:(\d+):(\d+)$/, async (ctx) => {
  const aptId = parseInt(ctx.match[1], 10);
  const groupId = parseInt(ctx.match[2], 10);
  const apt = (
    await pool.query("SELECT * FROM apartments WHERE id=$1", [aptId])
  ).rows[0];
  await pool.query("UPDATE apartments SET status='offered' WHERE id=$1", [aptId]);
  const members = (
    await pool.query(
      "SELECT tg_id FROM group_members WHERE group_id=$1 AND ready",
      [groupId]
    )
  ).rows;
  for (const m of members) {
    const caption =
      `🏠 *Новая квартира под вашу группу!*\n\n` +
      `*${apt.title}*\n${apt.rooms}-комн · ${apt.district} · ~${Math.ceil(apt.price / apt.rooms).toLocaleString("ru-RU")} ₽/чел\n` +
      (apt.address ? `📍 ${apt.address}\n` : "") +
      `\nОтметьте «интересно» в приложении — свяжем вас с собственником.`;
    await sendWithFloodRetry(async () => {
      if (apt.photo_id)
        await bot.api.sendPhoto(m.tg_id, apt.photo_id, {
          caption,
          parse_mode: "Markdown",
          reply_markup: openAppKeyboard(),
        });
      else
        await bot.api.sendMessage(m.tg_id, caption, {
          parse_mode: "Markdown",
          reply_markup: openAppKeyboard(),
        });
    });
    await sleep(50);
  }
  await ctx.answerCallbackQuery({ text: "Отправлено ✅" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
});

bot.on("message:text", async (ctx) => {
  if (!isAdmin(ctx)) return userSupportReply(ctx);
  const flow = ctx.session.adminFlow;
  if (!flow) return;
  const d = ctx.session.aptDraft || {};
  const text = ctx.message.text.trim();

  switch (flow) {
    case "apt_title":
      d.title = text;
      ctx.session.adminFlow = "apt_rooms";
      await ctx.reply("Сколько комнат? (число)");
      break;
    case "apt_rooms":
      d.rooms = parseInt(text, 10);
      ctx.session.adminFlow = "apt_price";
      await ctx.reply("Цена аренды в месяц? (только число, ₽)");
      break;
    case "apt_price":
      d.price = parseInt(text.replace(/\D/g, ""), 10);
      ctx.session.adminFlow = "apt_district";
      await ctx.reply("Район:", {
        reply_markup: {
          keyboard: [DISTRICTS.slice(0, 4), DISTRICTS.slice(4)],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
      break;
    case "apt_district":
      d.district = text;
      ctx.session.adminFlow = "apt_address";
      await ctx.reply("Адрес (улица, ориентиры — без номера квартиры):");
      break;
    case "apt_address":
      d.address = text;
      ctx.session.adminFlow = "apt_contact";
      await ctx.reply("Контакт собственника (телефон/@username или ссылка на объявление):");
      break;
    case "apt_contact": {
      d.contact = text;
      const { rows } = await pool.query(
        `INSERT INTO apartments (title, rooms, price, district, address, contact, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [d.title, d.rooms, d.price, d.district, d.address, d.contact, ctx.from!.id]
      );
      ctx.session.adminFlow = undefined;
      ctx.session.aptDraft = undefined;
      await ctx.reply(
        `✅ Квартира сохранена (#${rows[0].id}).\nМожно прислать фото — прикрепится к этой квартире.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Дальше →", callback_data: `apt_saved:${rows[0].id}` }],
            ],
          },
        }
      );
      break;
    }
    case "broadcast": {
      const { rows } = await pool.query("SELECT tg_id FROM users WHERE onboarded");
      let ok = 0;
      for (const r of rows) {
        // пауза + обработка 429: без этого на десятках адресатов рассылка
        // молча умирала на лимитах Telegram
        const sent = await sendWithFloodRetry(() =>
          bot.api.copyMessage(r.tg_id, ctx.chat.id, ctx.message.message_id)
        );
        if (sent) ok++;
        await sleep(50);
      }
      ctx.session.adminFlow = undefined;
      await ctx.reply(`📣 Отправлено ${ok}/${rows.length}`);
      break;
    }
  }
});

// фото от админа прикрепляем к последней созданной квартире
bot.on("message:photo", async (ctx) => {
  if (!isAdmin(ctx)) return userSupportReply(ctx);
  const pending = (
    await pool.query("SELECT id FROM apartments ORDER BY created_at DESC LIMIT 1")
  ).rows[0];
  const fileId = ctx.message.photo.pop()?.file_id;
  if (pending && fileId) {
    // сразу достаём file_path, чтобы приложению не пришлось дёргать getFile
    let filePath: string | null = null;
    try {
      filePath = (await bot.api.getFile(fileId)).file_path || null;
    } catch {}
    await pool.query(
      "UPDATE apartments SET photo_id=$1, photo_path=$2 WHERE id=$3",
      [fileId, filePath, pending.id]
    );
    await ctx.reply(`📷 Фото прикреплено к квартире #${pending.id}.`);
  }
});

// любой другой контент от пользователя (стикеры, документы, кружочки…)
bot.on("message", async (ctx) => {
  if (!isAdmin(ctx)) await userSupportReply(ctx);
});

bot.callbackQuery(/^apt_saved:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await offerAptToGroups(ctx, parseInt(ctx.match[1], 10));
});

export async function startBot() {
  bot.catch((err) => console.error("Bot error:", err));
  await bot.init();

  // оформление бота: команды, описания, кнопка меню.
  // Раньше чат с ботом был «голым»: без команд и описаний.
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Как это работает" },
      { command: "profile", description: "Моя анкета" },
    ]);
    await bot.api.setMyDescription(
      "Совместная аренда в Казани: найди соседей под свой образ жизни, соберите группу и получите подборку квартир под общий бюджет."
    );
    await bot.api.setMyShortDescription(
      "Поиск соседей для совместной аренды"
    );
    if (WEBAPP_URL)
      await bot.api.setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Открыть",
          web_app: { url: WEBAPP_URL },
        },
      });
  } catch (e) {
    console.error("Bot meta setup failed:", e);
  }

  await bot.start({ onStart: () => console.log("Bot started (polling)") });
}
