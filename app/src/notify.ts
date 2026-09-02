import { Bot } from "grammy";
import { WEBAPP_URL } from "./config";

// экранирование пользовательского текста для parse_mode: "HTML"
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Кликабельное упоминание пользователя, имя — экранировано. */
export function userLink(tgId: string | number, name: string): string {
  return `<a href="tg://user?id=${encodeURIComponent(String(tgId))}">${esc(name)}</a>`;
}

export function openAppKeyboard(text = "Открыть приложение") {
  return {
    inline_keyboard: [[{ text, web_app: { url: WEBAPP_URL } }]],
  };
}

export async function notifyMutualLike(
  bot: Bot<any>,
  a: { tg_id: string; first_name: string },
  b: { tg_id: string; first_name: string }
) {
  const text =
    `🤝 <b>Взаимный мэтч!</b>\n\n` +
    `Тебе и ${userLink(b.tg_id, b.first_name)} понравились профили друг друга.` +
    ` Продолжай в приложении — лайкни ещё двоих и собирай группу.`;
  await bot.api.sendMessage(a.tg_id, text, {
    parse_mode: "HTML",
    reply_markup: openAppKeyboard("Посмотреть профиль"),
  });
}

export async function notifyGroupInvite(
  bot: Bot<any>,
  tgId: string,
  creatorName: string,
  groupId: number
) {
  await bot.api.sendMessage(
    tgId,
    `👥 <b>${esc(creatorName)} предлагает сформировать группу для совместной аренды!</b>\n\n` +
      `Подтверди участие — когда все согласны, начнём подбирать квартиры под ваш общий бюджет.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Я в деле", callback_data: `grp_yes:${groupId}` },
            { text: "❌ Нет", callback_data: `grp_no:${groupId}` },
          ],
        ],
      },
    }
  );
}

export async function notifyGroupMemberLeft(
  bot: Bot<any>,
  tgId: string,
  whoLeft: string
) {
  await bot.api
    .sendMessage(
      tgId,
      `👋 ${esc(whoLeft)} вышел(а) из вашей группы. ` +
        `Можно добрать соседа во вкладке «Группа».`,
      { parse_mode: "HTML", reply_markup: openAppKeyboard() }
    )
    .catch(() => {});
}

export async function notifyGroupConfirmed(
  bot: Bot<any>,
  members: { tg_id: string; first_name: string }[],
  totalBudget: number
) {
  for (const m of members) {
    const others = members
      .filter((x) => x.tg_id !== m.tg_id)
      .map((x) => esc(x.first_name))
      .join(", ");
    await bot.api.sendMessage(
      m.tg_id,
      `🎉 Группа собрана!\n\nСостав: ${others}\nОбщий бюджет: <b>${totalBudget.toLocaleString(
        "ru-RU"
      )} ₽/мес</b>\n\nТеперь смотри подходящие квартиры во вкладке «Квартиры».`,
      { parse_mode: "HTML", reply_markup: openAppKeyboard() }
    );
  }
}
