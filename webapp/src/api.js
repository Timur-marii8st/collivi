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
  // vite dev: VITE_DEV_INITDATA позволяет тестировать мини-апп вне Telegram
  // (см. test/sign.mjs). В прод-сборке import.meta.env.DEV === false.
  if (import.meta.env.DEV && !tg?.initData) return import.meta.env.VITE_DEV_INITDATA || "";
  return tg?.initData || "";
}

// нативный alert() в Telegram часто подавляется — используем WebApp.showAlert
export function alertUser(message) {
  if (tg?.showAlert) {
    try {
      tg.showAlert(message);
      return;
    } catch (e) {}
  }
  window.alert(message);
}

// Promise<boolean> — подтверждение действия через диалог Telegram
export function confirmUser(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) {
      try {
        tg.showConfirm(message, (ok) => resolve(!!ok));
        return;
      } catch (e) {}
    }
    resolve(window.confirm(message));
  });
}

export async function api(path, options = {}) {
  const headers = { "x-init-data": initData(), ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let payload = {};
    try {
      payload = await res.json();
    } catch (e) {}
    const err = new Error(payload?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.serverMessage = payload?.error || null;
    throw err;
  }
  return res.json();
}

// фото квартир сервер отдаёт байтами (см. /api/.../photo), а не JSON —
// поэтому отдельный хелпер, возвращающий object-URL для <img>
export async function apiPhotoUrl(path) {
  const res = await fetch(path, { headers: { "x-init-data": initData() } });
  if (!res.ok) throw new Error(res.status);
  return URL.createObjectURL(await res.blob());
}
