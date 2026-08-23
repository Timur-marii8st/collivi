import crypto from "crypto";
import { BOT_TOKEN } from "./config";

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

/** Валидация initData по официальному алгоритму Telegram */
export function validateInitData(initData: string): TgUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("\n");
    const secret = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();
    const computed = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");
    if (computed !== hash) return null;

    const userRaw = params.get("user");
    if (!userRaw) return null;
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    // данные валидны 24 часа
    if (Math.floor(Date.now() / 1000) - authDate > 86400) return null;
    return JSON.parse(userRaw) as TgUser;
  } catch {
    return null;
  }
}
