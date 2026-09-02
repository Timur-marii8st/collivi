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
    if (!initData || !BOT_TOKEN) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
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
      .digest();

    const provided = Buffer.from(hash, "hex");
    if (
      provided.length !== computed.length ||
      !crypto.timingSafeEqual(provided, computed)
    )
      return null;

    const userRaw = params.get("user");
    if (!userRaw) return null;

    const now = Math.floor(Date.now() / 1000);
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    // данные валидны 24 часа; будущие метки времени тоже отбрасываем
    if (!authDate || authDate > now + 60 || now - authDate > 86400) return null;

    const user = JSON.parse(userRaw) as TgUser;
    if (!user || typeof user.id !== "number" || !Number.isFinite(user.id))
      return null;
    return user;
  } catch {
    return null;
  }
}
