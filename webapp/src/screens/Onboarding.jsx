import React, { useState } from "react";
import { api, haptic, initData } from "../api";

const DISTRICTS = [
  "Вахитовский", "Советский", "Приволжский", "Авиастроительный",
  "Ново-Савиновский", "Московский", "Кировский", "Любой",
];
const INTERESTS = [
  "спорт", "игры", "музыка", "кино", "готовка", "путешествия",
  "чтение", "программирование", "танцы", "фото", "аниме", "авто",
];

function fmtSleep(v) {
  const h = ((v % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

const STEPS = [
  {
    key: "age",
    title: "Сколько тебе лет?",
    sub: null,
    type: "number",
    placeholder: "18",
    min: 16,
    max: 60,
    hint: "Возраст — от 16 до 60",
  },
  {
    key: "gender",
    title: "Ты парень или девушка?",
    type: "chips",
    options: [["m", "Парень"], ["f", "Девушка"]],
  },
  {
    key: "occupation",
    title: "Где учишься / работаешь?",
    sub: "Выбери из списка — так легче найти однокурсников",
    type: "select",
    options: [
      ["КФУ", "КФУ — Казанский федеральный университет"],
      ["КНИТУ (КХТИ)", "КНИТУ — КХТИ"],
      ["КНИТУ-КАИ", "КНИТУ-КАИ"],
      ["КГЭУ", "КГЭУ — Энергетический университет"],
      ["КГАСУ", "КГАСУ — Архитектурно-строительный"],
      ["КГМУ", "КГМУ — Медицинский университет"],
      ["КГАВМ", "КГАВМ — Ветеринарная академия"],
      ["РГУП", "РГУП — Правосудие"],
      ["ТИСБИ", "ТИСБИ"],
      ["ККИ РУК", "ККИ РУК"],
      ["УВО «Университет управления «ТИСБИ»»", "Университет управления «ТИСБИ»"],
      ["КФ РЭУ им. Плеханова", "РЭУ им. Плеханова (КФ)"],
      ["Работаю", "Работаю"],
      ["Другое", "Другое"],
    ],
  },
  {
    key: "budget",
    title: "Сколько готов платить за свою комнату в месяц?",
    sub: "Без учёта коммуналки",
    type: "number",
    placeholder: "15000",
    suffix: " ₽",
    min: 5000,
    max: 200000,
    hint: "Бюджет — от 5 000 до 200 000 ₽",
  },
  {
    key: "districts",
    title: "Какие районы рассматриваешь?",
    type: "multichips",
    options: DISTRICTS.map((d) => [d, d]),
  },
  {
    key: "move_in",
    title: "Когда готов заселиться?",
    type: "chips",
    options: [["week", "В ближайшую неделю"], ["twoweeks", "Через 1–2 недели"], ["month", "Примерно через месяц"], ["later", "Позже"]],
  },
  {
    key: "smoking",
    title: "Курение дома?",
    type: "chips",
    options: [["no", "Не курю"], ["yes", "Курю"]],
  },
  {
    key: "alcohol",
    title: "Алкоголь дома?",
    type: "chips",
    options: [["no", "Не пью"], ["sometimes", "Иногда"], ["yes", "Свободно"]],
  },
  {
    key: "sleep_time",
    title: "Во сколько обычно ложишься?",
    type: "slider",
    min: 21,
    max: 27,
    format: fmtSleep,
  },
  {
    key: "cleanliness",
    title: "Насколько важна чистота?",
    sub: "1 — творческий беспорядок · 10 — стерильно",
    type: "slider",
    min: 1,
    max: 10,
    format: (v) => `${v}/10`,
  },
  {
    key: "guests",
    title: "Гости у соседей — это…",
    type: "chips",
    options: [["never", "Не хочу гостей дома"], ["sometimes", "Иногда — нормально"], ["often", "Пусть будут свободно"]],
  },
  {
    key: "parties",
    title: "Вечеринки дома?",
    type: "chips",
    options: [["no", "Нет, дом для отдыха"], ["yes", "Да, иногда можно"]],
  },
  {
    key: "pets",
    title: "Животные?",
    type: "chips",
    special: true,
    options: [["has", "У меня есть питомец"], ["ok", "Можно с питомцем"], ["no", "Лучше без животных"]],
  },
  {
    key: "sociability",
    title: "Насколько общительный?",
    type: "chips",
    options: [["high", "Люблю общаться"], ["medium", "По настроению"], ["low", "Предпочитаю тишину"]],
  },
  {
    key: "interests",
    title: "Что тебе ближе?",
    sub: "Выбери до 5",
    type: "interests",
    options: INTERESTS.map((i) => [i, i]),
  },
];

export default function Onboarding({ initial, onDone, onCancel }) {
  // initial приходит при редактировании анкеты из «Профиля»
  const editing = !!initial?.onboarded;
  const [step, setStep] = useState(0);
  const [data, setData] = useState(() => {
    const base = {
      districts: [],
      lease_months: 12,
      pets_ok: true,
      pets_has: false,
      interests: [],
      // без дефолтов у слайдеров «Дальше» была заблокирована,
      // пока человек не подвинет ползунок — тупик без объяснения
      sleep_time: 23,
      cleanliness: 5,
    };
    if (!editing) return base;
    // в БД час сна хранится как 0-23, а шкала 21-27 (25 = 01:00);
    // возвращаем ночные часы обратно на шкалу
    const sleep =
      initial.sleep_time == null
        ? 23
        : initial.sleep_time >= 21
          ? initial.sleep_time
          : initial.sleep_time + 24;
    return {
      ...base,
      age: initial.age ?? "",
      gender: initial.gender ?? undefined,
      prefer_gender: initial.gender ?? undefined,
      occupation: initial.occupation ?? "",
      budget: initial.budget ?? "",
      districts: initial.districts || [],
      move_in: initial.move_in ?? undefined,
      lease_months: initial.lease_months || 12,
      smoking: initial.smoking ?? undefined,
      alcohol: initial.alcohol ?? undefined,
      sleep_time: sleep,
      cleanliness: initial.cleanliness ?? 5,
      guests: initial.guests ?? undefined,
      parties: initial.parties ?? undefined,
      pets: initial.pets_has ? "has" : initial.pets_ok ? "ok" : "no",
      pets_ok: !!initial.pets_ok,
      pets_has: !!initial.pets_has,
      sociability: initial.sociability ?? undefined,
      interests: initial.interests || [],
    };
  });
  const [saving, setSaving] = useState(false);

  const s = STEPS[step];
  const val = data[s.key];

  // возраст и бюджет проверяем сразу на шаге, а не сервером в самом конце
  const numVal =
    s.type === "number" ? parseInt(String(val ?? "").trim(), 10) : null;
  const numError =
    s.type === "number" &&
    String(val ?? "").trim() !== "" &&
    (!Number.isFinite(numVal) ||
      (s.min !== undefined && numVal < s.min) ||
      (s.max !== undefined && numVal > s.max))
      ? s.hint
      : null;

  const canNext =
    s.type === "number" || s.type === "text"
      ? String(val ?? "").trim().length > 0 && !numError
      : Array.isArray(val)
        ? val.length > 0
        : val !== undefined;

  function pick(v) {
    haptic();
    if (s.key === "gender") setData({ ...data, gender: v, prefer_gender: v });
    else if (s.key === "districts")
      setData({
        ...data,
        districts: data.districts.includes("Любой")
          ? ["Любой"]
          : v === "Любой"
            ? ["Любой"]
            : data.districts.includes(v)
              ? data.districts.filter((x) => x !== v)
              : [...data.districts.filter((x) => x !== "Любой"), v],
      });
    else setData({ ...data, [s.key]: v });
  }

  function toggleInterest(i) {
    haptic();
    const cur = data.interests;
    if (cur.includes(i)) setData({ ...data, interests: cur.filter((x) => x !== i) });
    else if (cur.length < 5) setData({ ...data, interests: [...cur, i] });
  }

  async function next() {
    haptic();
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      window.scrollTo(0, 0);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        age: parseInt(data.age, 10),
        gender: data.gender,
        prefer_gender: data.gender,
        occupation: data.occupation,
        budget: parseInt(data.budget, 10),
        districts: data.districts,
        move_in: data.move_in,
        smoking: data.smoking,
        alcohol: data.alcohol,
        sleep_time: data.sleep_time % 24,
        cleanliness: data.cleanliness,
        guests: data.guests,
        parties: data.parties,
        pets_has: data.pets === "has",
        pets_ok: data.pets !== "no",
        sociability: data.sociability,
        interests: data.interests,
        lease_months: data.lease_months || 12,
      };
      const saved = await api("/api/me", { method: "POST", body: payload });
      haptic("success");
      onDone(saved);
    } catch (e) {
      alert("Ошибка сохранения: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="onboard">
      {onCancel && (
        <div style={{ marginBottom: 10 }}>
          <button className="chip" onClick={onCancel}>← Отменить</button>
        </div>
      )}
      <div className="progress">
        <div style={{ width: pct + "%" }} />
      </div>
      <div className="step-count">
        {step + 1} / {STEPS.length}
      </div>
      <h1 className="q-title">{s.title}</h1>
      {s.sub && <p className="q-sub">{s.sub}</p>}

      {(s.type === "number" || s.type === "text") && (
        <input
          className="input"
          type={s.type}
          inputMode={s.type === "number" ? "numeric" : "text"}
          placeholder={s.placeholder}
          value={val || ""}
          autoFocus
          onChange={(e) => setData({ ...data, [s.key]: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && canNext && next()}
        />
      )}
      {numError && (
        <p className="q-sub" style={{ color: "var(--red, #e05c5c)" }}>
          {numError}
        </p>
      )}

      {s.type === "select" && (
        <select
          className="input"
          value={val || ""}
          autoFocus
          onChange={(e) => setData({ ...data, [s.key]: e.target.value })}
        >
          <option value="" disabled>Выбери вариант…</option>
          {s.options.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      )}

      {(s.type === "chips" || s.type === "multichips") && (
        <div className="chips">
          {s.options.map(([v, label]) => {
            const active = Array.isArray(val) ? val.includes(v) : val === v;
            return (
              <button
                key={v}
                className={"chip" + (active ? " active" : "")}
                onClick={() => pick(v)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {s.type === "slider" && (
        <div className="slider-wrap">
          <div className="slider-val">{s.format(val ?? s.min)}</div>
          <input
            type="range"
            min={s.min}
            max={s.max}
            value={val ?? s.min}
            onChange={(e) => setData({ ...data, [s.key]: +e.target.value })}
          />
        </div>
      )}

      {s.type === "interests" && (
        <div className="chips">
          {s.options.map(([v]) => (
            <button
              key={v}
              className={"chip" + (val.includes(v) ? " active" : "")}
              onClick={() => toggleInterest(v)}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <button className="next-btn" disabled={!canNext || saving} onClick={next}>
        {saving
          ? "Сохраняем…"
          : step === STEPS.length - 1
            ? editing
              ? "Сохранить изменения"
              : "Начать поиск соседей →"
            : "Дальше"}
      </button>
    </div>
  );
}
