import { Bot, Context, session, SessionFlavor } from "grammy";
import { limit } from "@grammyjs/ratelimiter";
import { BOT_TOKEN, ADMIN_IDS, WEBAPP_URL, TG_PROXY } from "./config";
import { pool } from "./db";
import { openAppKeyboard, esc, userLink } from "./notify";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HttpsProxyAgent } = require("https-proxy-agent");

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface SessionData {
  adminFlow?: string;
  aptDraft?: Record<string, any>;
  lastAptId?: number;
  broadcastRef?: { chatId: number; messageId: number };
}
type MyCtx = Context & SessionFlavor<SessionData>;

export const bot = new Bot<MyCtx>(
  BOT_TOKEN,
  TG_PROXY
    ? { client: { baseFetchConfig: { agent: new HttpsProxyAgent(TG_PROXY) as never } } }
    : {}
);
bot.use(session({ initial: (): SessionData => ({}) }));

// анти-флуд: не больше ~5 апдейтов за 2 сек с одного пользователя
bot.use(
  limit({
    timeFrame: 2000,
    limit: 5,
    onLimitExceeded: async (ctx) => {
      await ctx.reply("Слишком часто — подожди пару секунд 🙂").catch(() => {});
    },
  })
);

if (!ADMIN_IDS.length) {
  bot.on("message", (ctx) =>
    console.log(`[SETUP] Чтобы включить админку, добавь в ADMIN_IDS: ${ctx.from?.id}`)
  );
}

export function isAdmin(ctx: MyCtx): boolean {
  return ADMIN_IDS.includes(ctx.from?.id || 0);
}

// ---------- пользовательские команды ----------


function safeError(e: unknown): string {
  return String((e as any)?.message || e).replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***");
}

async function userSupportReply(ctx: MyCtx) {
  await ctx.reply(
    "Привет! Я бот сервиса «Свои». Изменить анкету, смотреть соседей и квартиры можно в приложении. Сообщение передали команде.",
    { reply_markup: openAppKeyboard() }
  );
  for (const id of ADMIN_IDS) await ctx.forwardMessage(id).catch(() => {});
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    `👋 Привет, ${esc(ctx.from?.first_name || "")}!\n\n` +
      `Я помогаю находить <b>соседей под тебя</b> и снимать большую квартиру вместе — ` +
      `отдельная комната по цене комнаты в коммуналке, но с людьми, которые совпадают с тобой по образу жизни.\n\n` +
      `1️⃣ Заполни короткую анкету (3 минуты)\n` +
      `2️⃣ Смотри карточки совместимых соседей\n` +
      `3️⃣ Соберите группу из 3–4 человек\n` +
      `4️⃣ Получите подборку квартир под ваш бюджет\n\n` +
      `Жми кнопку ниже 👇`,
    { parse_mode: "HTML", reply_markup: openAppKeyboard("Заполнить анкету") }
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

bot.command("help", async (ctx) => {
  await ctx.reply(
    `<b>Свои</b> — подбор совместимых соседей и сборка группы под общую аренду.\n\n` +
      `/start — начать, открыть приложение\n` +
      `/profile — статус анкеты\n` +
      `/delete_me — удалить профиль и все данные\n\n` +
      `Вопросы и правки анкеты — просто напиши сюда.`,
    { parse_mode: "HTML" }
  );
});

// ---------- удаление данных ----------

bot.command("delete_me", async (ctx) => {
  await ctx.reply(
    "Удалить твой профиль, анкету, лайки и выйти из групп? Это необратимо.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🗑 Удалить всё", callback_data: "del_me_yes" },
            { text: "Отмена", callback_data: "del_me_no" },
          ],
        ],
      },
    }
  );
});

bot.callbackQuery("del_me_no", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Отменено" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
});

bot.callbackQuery("del_me_yes", async (ctx) => {
  const me = String(ctx.from!.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: groups } = await client.query(
      `SELECT g.id
       FROM groups g JOIN group_members gm ON gm.group_id=g.id
       WHERE gm.tg_id=$1
       FOR UPDATE OF g`,
      [me]
    );

    // Явная очистка нужна и для баз, созданных до появления FK ON DELETE CASCADE.
    await client.query("DELETE FROM likes WHERE from_tg=$1 OR to_tg=$1", [me]);
    await client.query("DELETE FROM dislikes WHERE from_tg=$1 OR to_tg=$1", [me]);
    await client.query("DELETE FROM apt_interest WHERE tg_id=$1", [me]);
    await client.query("DELETE FROM group_members WHERE tg_id=$1", [me]);

    for (const g of groups) {
      const { rows: rest } = await client.query(
        "SELECT tg_id FROM group_members WHERE group_id=$1",
        [g.id]
      );
      if (rest.length < 2) {
        if (rest.length) {
          await client.query(
            "UPDATE users SET status='active' WHERE tg_id = ANY($1::bigint[])",
            [rest.map((x: any) => String(x.tg_id))]
          );
        }
        await client.query("DELETE FROM apt_interest WHERE group_id=$1", [g.id]);
        await client.query("DELETE FROM group_members WHERE group_id=$1", [g.id]);
        await client.query("DELETE FROM groups WHERE id=$1", [g.id]);
      }
    }

    await client.query("DELETE FROM users WHERE tg_id=$1", [me]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("delete_me failed:", e);
    await ctx.answerCallbackQuery({ text: "Не получилось, попробуй позже" });
    client.release();
    return;
  }
  client.release();
  await ctx.answerCallbackQuery({ text: "Удалено" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  await ctx.reply("Готово — все данные удалены. Захочешь вернуться — просто напиши /start.");
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
  // если остался один — расформировать
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM group_members WHERE group_id=$1",
    [groupId]
  );
  if (rows[0].n < 2)
    await pool.query("DELETE FROM groups WHERE id=$1", [groupId]);
  await ctx.answerCallbackQuery({ text: "Ок, без обид 🙂" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
});

export async function checkGroupComplete(groupId: number) {
  const client = await pool.connect();
  let rows: any[] = [];
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT gm.tg_id, gm.ready, u.first_name, u.budget
       FROM groups g
       JOIN group_members gm ON gm.group_id=g.id
       JOIN users u ON u.tg_id=gm.tg_id
       WHERE g.id=$1 AND g.status='forming'
       FOR UPDATE OF g`,
      [groupId]
    );
    rows = current.rows;
    if (!rows.length || rows.some((r: any) => !r.ready)) {
      await client.query("ROLLBACK");
      return;
    }

    const changed = await client.query(
      "UPDATE groups SET status='confirmed' WHERE id=$1 AND status='forming' RETURNING id",
      [groupId]
    );
    if (!changed.rows.length) {
      await client.query("ROLLBACK");
      return;
    }

    await client.query(
      "UPDATE users SET status='in_group' WHERE tg_id = ANY($1::bigint[])",
      [rows.map((r: any) => String(r.tg_id))]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const members = rows.map((r) => ({ tg_id: String(r.tg_id), first_name: r.first_name }));
  const totalBudget = rows.reduce((s, r) => s + (r.budget || 0), 0);

  // Уведомления идут только после успешного единственного перехода в confirmed.
  try {
    const { notifyGroupConfirmed } = await import("./notify");
    await notifyGroupConfirmed(bot, members, totalBudget);

    for (const adminId of ADMIN_IDS) {
      const list = members
        .map((m) => `• ${userLink(m.tg_id, m.first_name)}`)
        .join("\n");
      await bot.api
        .sendMessage(
          adminId,
          `✅ <b>Сформирована группа #${groupId}</b>\n${list}\nОбщий бюджет: ${totalBudget.toLocaleString("ru-RU")} ₽`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }
  } catch (e) {
    console.error("checkGroupComplete: уведомления не отправлены:", e);
  }
}

// ---------- админка ----------

async function adminMenu(ctx: MyCtx) {
  await ctx.reply("⚙️ Админ-панель", {
    reply_markup: {
      inline_keyboard: [
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
    `📊 <b>Статистика</b>\n\nАнкет заполнено: ${u.rows[0].n}\nГрупп всего: ${g.rows[0].n}\nГрупп подтверждено: ${gc.rows[0].n}\nКвартир в базе: ${a.rows[0].n}`,
    { parse_mode: "HTML" }
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
          `👤 <b>${esc(r.first_name)}</b> ${r.age ? `(${r.age})` : ""}${r.username ? ` @${esc(r.username)}` : ""}\n` +
          `${esc(r.occupation || "—")} · ${r.budget ? r.budget.toLocaleString("ru-RU") + " ₽" : "—"} · ${esc((r.districts || []).join(", ") || "—")}`
      )
      .join("\n\n") || "Пока нет анкет";
  await ctx.reply(text, { parse_mode: "HTML" });
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
          `🏠 <b>${esc(a.title)}</b>\n${a.rooms}-комн · ${esc(a.district)} · ${a.price.toLocaleString("ru-RU")} ₽ (~${Math.ceil(a.price / a.rooms).toLocaleString("ru-RU")} ₽/чел)\n${esc(a.address || "")} · статус: ${esc(a.status)}`
      )
      .join("\n\n") || "Квартир пока нет";
  await ctx.reply(text, { parse_mode: "HTML" });
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
      `🏠 <b>Новая квартира под вашу группу!</b>\n\n` +
      `<b>${esc(apt.title)}</b>\n${apt.rooms}-комн · ${esc(apt.district)} · ~${Math.ceil(apt.price / apt.rooms).toLocaleString("ru-RU")} ₽/чел\n` +
      (apt.address ? `📍 ${esc(apt.address)}\n` : "") +
      `\nОтметь «интересно» в приложении — свяжем вас с собственником.`;
    try {
      if (apt.photo_id)
        await bot.api.sendPhoto(m.tg_id, apt.photo_id, {
          caption,
          parse_mode: "HTML",
          reply_markup: openAppKeyboard(),
        });
      else
        await bot.api.sendMessage(m.tg_id, caption, {
          parse_mode: "HTML",
          reply_markup: openAppKeyboard(),
        });
    } catch {}
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
      ctx.session.lastAptId = rows[0].id; // сюда прикрепится следующее фото
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
      // не рассылаем сразу — сохраняем ссылку на сообщение и просим подтвердить
      ctx.session.broadcastRef = {
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
      };
      ctx.session.adminFlow = undefined;
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int n FROM users WHERE onboarded"
      );
      await ctx.reply(
        `📣 Разослать это сообщение ${rows[0].n} пользователям?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Разослать", callback_data: "bcast_go" },
                { text: "❌ Отмена", callback_data: "bcast_cancel" },
              ],
            ],
          },
        }
      );
      break;
    }
  }
});

bot.callbackQuery("bcast_cancel", async (ctx) => {
  ctx.session.broadcastRef = undefined;
  await ctx.answerCallbackQuery({ text: "Отменено" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
});

bot.callbackQuery("bcast_go", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const ref = ctx.session.broadcastRef;
  if (!ref) {
    await ctx.answerCallbackQuery({ text: "Нет сообщения для рассылки" });
    return;
  }
  ctx.session.broadcastRef = undefined;
  await ctx.answerCallbackQuery({ text: "Рассылаю…" });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });

  const { rows } = await pool.query("SELECT tg_id FROM users WHERE onboarded");
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await bot.api.copyMessage(rows[i].tg_id, ref.chatId, ref.messageId);
      ok++;
    } catch {}
    // Telegram ограничивает ~30 сообщений/сек — держимся заметно ниже
    if ((i + 1) % 20 === 0) await sleep(1000);
  }
  await ctx.reply(`📣 Отправлено ${ok}/${rows.length}`);
});

// фото от админа прикрепляем к последней сохранённой в этой сессии квартире
bot.on("message:photo", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const aptId = ctx.session.lastAptId;
  if (!aptId) {
    await ctx.reply("Сначала добавь квартиру через /admin → «Добавить квартиру».");
    return;
  }
  const fileId = ctx.message.photo[ctx.message.photo.length - 1]?.file_id;
  if (fileId) {
    await pool.query("UPDATE apartments SET photo_id=$1 WHERE id=$2", [fileId, aptId]);
    await ctx.reply(`📷 Фото прикреплено к квартире #${aptId}.`);
  }
});

bot.callbackQuery(/^apt_saved:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await offerAptToGroups(ctx, parseInt(ctx.match[1], 10));
});

async function registerCommands() {
  await bot.api.setMyCommands([
    { command: "start", description: "Начать · открыть приложение" },
    { command: "profile", description: "Статус анкеты" },
    { command: "help", description: "Помощь" },
    { command: "delete_me", description: "Удалить профиль и данные" },
  ]);
  for (const adminId of ADMIN_IDS) {
    await bot.api
      .setMyCommands(
        [
          { command: "start", description: "Начать · открыть приложение" },
          { command: "profile", description: "Статус анкеты" },
          { command: "help", description: "Помощь" },
          { command: "delete_me", description: "Удалить профиль и данные" },
          { command: "admin", description: "Админ-панель" },
        ],
        { scope: { type: "chat", chat_id: adminId } }
      )
      .catch(() => {});
  }
}

export async function startBot() {
  bot.catch((err) => console.error("Bot error:", safeError(err)));
  await bot.init();
  await registerCommands().catch((e) => console.error("setMyCommands failed:", safeError(e)));

  const setupCalls: Array<[string, () => Promise<unknown>]> = [
    ["setMyDescription", () => bot.api.setMyDescription(
      "Совместная аренда в Казани: найди соседей под свой образ жизни, соберите группу и получите подборку квартир под общий бюджет."
    )],
    ["setMyShortDescription", () => bot.api.setMyShortDescription("Поиск соседей для совместной аренды")],
    ...(WEBAPP_URL ? [[
      "setChatMenuButton",
      () => bot.api.setChatMenuButton({
        menu_button: { type: "web_app", text: "Открыть", web_app: { url: WEBAPP_URL } },
      }),
    ] as [string, () => Promise<unknown>]] : []),
  ];
  for (const [name, fn] of setupCalls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await fn(); break; }
      catch (e) {
        console.error(`Bot meta ${name} (attempt ${attempt}):`, safeError(e));
        if (attempt < 3) await sleep(2000);
      }
    }
  }

  await bot.start({ onStart: () => console.log("Bot started (polling)") });
}
