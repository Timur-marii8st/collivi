import { Bot } from "grammy";
import { WEBAPP_URL } from "./config";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Отправка с учётом лимитов Telegram: при 429 ждём retry_after и повторяем один раз.
 * Возвращает, дошло ли сообщение.
 */
export async function sendWithFloodRetry<T>(
  send: () => Promise<T>
): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (e: any) {
    const retryAfter = e?.parameters?.retry_after;
    if (retryAfter) {
      await sleep((Number(retryAfter) + 1) * 1000);
      try {
        await send();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function openAppKeyboard(text = "Открыть приложение") {
  return {
    inline_keyboard: [
      [{ text, web_app: { url: WEBAPP_URL } }],
    ],
  };
}

export async function notifyMutualLike(
  bot: Bot<any>,
  a: { tg_id: string; first_name: string },
  b: { tg_id: string; first_name: string }
) {
  const text =
    `🤝 *Взаимный мэтч!*\n\n` +
    `Тебе и [${b.first_name}](tg://user?id=${b.tg_id}) понравились профили друг друга.` +
    ` Продолжай в приложении — лайкни ещё двоих и собирай группу.`;
  await bot.api.sendMessage(a.tg_id, text, {
    parse_mode: "Markdown",
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
    `👥 *${creatorName} предлагает сформировать группу для совместной аренды!*\n\n` +
      `Подтверди участие — когда все согласны, начнём подбирать квартиры под ваш общий бюджет.`,
    {
      parse_mode: "Markdown",
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

export async function notifyGroupConfirmed(
  bot: Bot<any>,
  members: { tg_id: string; first_name: string }[],
  totalBudget: number
) {
  for (const m of members) {
    const others = members
      .filter((x) => x.tg_id !== m.tg_id)
      .map((x) => x.first_name)
      .join(", ");
    await bot.api.sendMessage(
      m.tg_id,
      `🎉 Группа собрана!\n\nСостав: ${others}\nОбщий бюджет: *${totalBudget.toLocaleString(
        "ru-RU"
      )} ₽/мес*\n\nТеперь смотри подходящие квартиры во вкладке «Квартиры».`,
      { parse_mode: "Markdown", reply_markup: openAppKeyboard() }
    );
  }
}
