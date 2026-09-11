// Справочники и подписи для админ-панели.
// Значения обязаны совпадать с Onboarding.jsx, валидацией в POST /api/me и matching.ts.

export const DISTRICTS = [
  "Вахитовский", "Советский", "Приволжский", "Авиастроительный",
  "Ново-Савиновский", "Московский", "Кировский", "Любой",
];

export const INTERESTS = [
  "спорт", "игры", "музыка", "кино", "готовка", "путешествия",
  "чтение", "программирование", "танцы", "фото", "аниме", "авто",
];

export const LABELS = {
  gender: { m: "Парень", f: "Девушка" },
  move_in: {
    week: "В неделю", twoweeks: "1–2 недели",
    month: "Через месяц", later: "Позже",
  },
  smoking: { no: "Не курю", yes: "Курю" },
  alcohol: { no: "Не пью", sometimes: "Иногда", yes: "Свободно" },
  guests: { never: "Без гостей", sometimes: "Иногда", often: "Свободно" },
  parties: { no: "Тишина", yes: "Иногда можно" },
  sociability: { high: "Общительный", medium: "По настроению", low: "Тихий" },
  status: { active: "Активен", in_group: "В группе" },
  group_status: { forming: "Собирается", confirmed: "Подтверждена", searching: "Ищет квартиру" },
  apt_status: { available: "Свободна", offered: "Предложена", rented: "Сдана", hidden: "Скрыта" },
};

// Порядок и типы полей в форме редактирования анкеты
export const USER_FORM = [
  { key: "first_name", label: "Имя", type: "text" },
  { key: "username", label: "Username", type: "text" },
  { key: "age", label: "Возраст", type: "number" },
  { key: "gender", label: "Пол", type: "enum", opts: "gender" },
  { key: "occupation", label: "Учёба / работа", type: "text" },
  { key: "budget", label: "Бюджет за комнату, ₽", type: "number" },
  { key: "districts", label: "Районы", type: "multi", opts: DISTRICTS },
  { key: "move_in", label: "Заселение", type: "enum", opts: "move_in" },
  { key: "lease_months", label: "Срок аренды, мес.", type: "number" },
  { key: "smoking", label: "Курение", type: "enum", opts: "smoking" },
  { key: "alcohol", label: "Алкоголь", type: "enum", opts: "alcohol" },
  { key: "sleep_time", label: "Ложится спать, час (0–23)", type: "number" },
  { key: "cleanliness", label: "Чистота (1–10)", type: "number" },
  { key: "guests", label: "Гости", type: "enum", opts: "guests" },
  { key: "parties", label: "Вечеринки", type: "enum", opts: "parties" },
  { key: "pets_ok", label: "Готов жить с животными", type: "bool" },
  { key: "pets_has", label: "Есть питомец", type: "bool" },
  { key: "sociability", label: "Характер", type: "enum", opts: "sociability" },
  { key: "interests", label: "Интересы", type: "multi", opts: INTERESTS },
  { key: "status", label: "Статус", type: "enum", opts: "status" },
  { key: "onboarded", label: "Анкета заполнена", type: "bool" },
  { key: "admin_note", label: "Заметка администратора", type: "text" },
];

export const APT_FORM = [
  { key: "title", label: "Название", type: "text" },
  { key: "rooms", label: "Комнат", type: "number" },
  { key: "price", label: "Цена, ₽/мес", type: "number" },
  { key: "district", label: "Район", type: "enum", opts: DISTRICTS },
  { key: "address", label: "Адрес", type: "text" },
  { key: "contact", label: "Контакт собственника", type: "text" },
  { key: "isolated_rooms", label: "Изолированные комнаты", type: "bool" },
  { key: "status", label: "Статус", type: "enum", opts: "apt_status" },
];

export function money(n) {
  return n == null ? "—" : Number(n).toLocaleString("ru-RU") + " ₽";
}

export function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function label(group, value) {
  return LABELS[group]?.[value] || value || "—";
}
