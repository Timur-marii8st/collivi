const tg = window.Telegram?.WebApp;

tg?.ready();
tg?.expand();
try {
  tg?.setHeaderColor("secondary_bg_color");
  tg?.setBackgroundColor("bg_color");
} catch (e) {}

export function haptic(type = "light") {
  try {
    if (type === "success" || type === "error")
      tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch (e) {}
}

export function initData() {
  return tg?.initData || "";
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-init-data": initData(),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || res.status);
  return res.json();
}
