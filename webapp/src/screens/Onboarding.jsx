import React, { useEffect, useState } from "react";
import { api, haptic, alertUser } from "../api";

const DISTRICTS = [
  "Вахитовский", "Советский", "Приволжский", "Авиастроительный",
  "Ново-Савиновский", "Московский", "Кировский", "Любой",
];
const INTERESTS = [
  "спорт", "игры", "музыка", "кино", "готовка", "путешествия",
  "чтение", "программирование", "танцы", "фото", "аниме", "авто",
];
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function fmtSleep(v) {
  const h = ((v % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

const CUR_YEAR = new Date().getFullYear();
const YEARS = [];
for (let y = CUR_YEAR - 18; y >= 1950; y--) YEARS.push(y);

function dobStatus(b) {
  if (!b || !b.d || !b.m || !b.y) return "incomplete";
  const d = +b.d, m = +b.m, y = +b.y;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return "invalid";
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  if (age < 18) return "underage";
  return "ok";
}

function dobISO(b) {
  if (!b || !b.d || !b.m || !b.y) return null;
  return `${b.y}-${String(b.m).padStart(2, "0")}-${String(b.d).padStart(2, "0")}`;
}

const STEPS = [
  {
    key: "birthdate",
    title: "Дата рождения",
    sub: null,
    type: "dob",
  },
  { key: "gender", title: "Ты парень или девушка?", type: "chips", options: [["m", "Парень"], ["f", "Девушка"]] },
  {
    key: "prefer_gender",
    title: "С кем хочешь жить?",
    type: "chips",
    options: [["any", "Не важно"], ["mixed", "Смешанная группа"], ["m", "Только парни"], ["f", "Только девушки"]],
  },
  {
    key: "budget",
    title: "Сколько готов платить за свою комнату?",
    sub: "Вилка в месяц, без коммуналки",
    type: "budget",
  },
  { key: "districts", title: "Какие районы рассматриваешь?", type: "multichips", options: DISTRICTS.map((d) => [d, d]) },
  {
    key: "move_in",
    title: "Когда готов заселиться?",
    type: "chips",
    options: [["week", "В ближайшую неделю"], ["twoweeks", "Через 1–2 недели"], ["month", "Примерно через месяц"], ["later", "Позже"]],
  },
  {
    key: "lease_months",
    title: "На какой срок снимаешь?",
    type: "chips",
    options: [["6", "Полгода"], ["12", "Год"], ["24", "Год и дольше"], ["0", "Пока не знаю"]],
  },
  {
    key: "_count",
    title: "Смотрим, кто подходит",
    type: "count",
  },
  {
    key: "occupation",
    title: "Где учишься / работаешь?",
    sub: "Выбери из списка — так легче найти однокурсников",
    type: "select",
    placeholder: "Выбери вариант…",
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
  { key: "smoking", title: "Курение дома?", type: "chips", options: [["no", "Не курю"], ["yes", "Курю"]] },
  {
    key: "alcohol",
    title: "Алкоголь дома?",
    type: "chips",
    options: [["no", "Не пью"], ["sometimes", "Иногда"], ["yes", "Свободно"]],
  },
  { key: "sleep_time", title: "Во сколько обычно ложишься?", type: "slider", min: 21, max: 27, format: fmtSleep },
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
    key: "priorities",
    title: "Что для тебя важнее в соседе?",
    sub: "Выбери 2–3 — под них подстроим подбор",
    type: "priorities",
    max: 3,
    options: [
      ["quiet", "Тишина и режим"],
      ["clean", "Чистота"],
      ["social", "Общение"],
      ["budget", "Близкий бюджет"],
      ["schedule", "Совпадение графика"],
    ],
  },
  { key: "interests", title: "Что тебе ближе?", sub: "Выбери до 5", type: "interests", options: INTERESTS.map((i) => [i, i]) },
];

const Q_TOTAL = STEPS.filter((s) => s.type !== "count").length;

const DRAFT_KEY = "svoi:onboarding";
const BASE = {
  prefer_gender: "any",
  districts: [],
  pets_ok: true,
  pets_has: false,
  interests: [],
  priorities: [],
  sleep_time: 24,
  cleanliness: 5,
  birth: { d: "", m: "", y: "" },
  budget: { min: "", max: "" },
};

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && p.data && typeof p.data === "object") return p;
  } catch (e) {}
  return null;
}

export default function Onboarding({ me, onDone }) {
  const draft = loadDraft();
  const [step, setStep] = useState(() => {
    const n = draft?.step;
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  });
  const [data, setData] = useState(() => ({
    ...BASE,
    ...(draft?.data || {}),
    birth: { ...BASE.birth, ...(draft?.data?.birth || {}) },
    budget: { ...BASE.budget, ...(draft?.data?.budget || {}) },
  }));
  const [saving, setSaving] = useState(false);
  const [countState, setCountState] = useState({ loading: false, value: null, error: false });

  const s = STEPS[step];
  const val = data[s.key];

  const dob = s.type === "dob" ? dobStatus(data.birth) : null;
  const budgetOk =
    s.type === "budget" &&
    /^\d+$/.test(String(data.budget.min)) &&
    /^\d+$/.test(String(data.budget.max)) &&
    +data.budget.min <= +data.budget.max;

  const canNext =
    s.type === "dob"
      ? dob === "ok"
      : s.type === "budget"
        ? budgetOk
        : s.type === "count"
          ? !countState.loading
          : s.type === "text" || s.type === "select"
            ? String(val ?? "").trim().length > 0
            : s.type === "priorities"
              ? Array.isArray(val) && val.length >= 2
              : Array.isArray(val)
                ? val.length > 0
                : val !== undefined;

  const dobError =
    dob === "invalid" ? "Такой даты не существует" : dob === "underage" ? "Регистрация с 18 лет" : null;
  const budgetError =
    s.type === "budget" &&
    String(data.budget.min) !== "" &&
    String(data.budget.max) !== "" &&
    !budgetOk
      ? "«От» не может быть больше «до»"
      : null;

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, data }));
    } catch (e) {}
  }, [step, data]);

  useEffect(() => {
    const w = window.Telegram?.WebApp;
    try {
      w?.enableClosingConfirmation?.();
    } catch (e) {}
    return () => {
      try {
        w?.disableClosingConfirmation?.();
      } catch (e) {}
    };
  }, []);

  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;
    const onBack = () => setStep((p) => Math.max(0, p - 1));
    bb.onClick(onBack);
    return () => {
      try {
        bb.offClick(onBack);
        bb.hide();
      } catch (e) {}
    };
  }, []);

  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;
    if (step > 0) bb.show();
    else bb.hide();
  }, [step]);

  // предпросмотр количества совпадений
  useEffect(() => {
    if (STEPS[step]?.type !== "count") return;
    setCountState({ loading: true, value: null, error: false });
    api("/api/candidates/preview", {
      method: "POST",
      body: {
        birthdate: dobISO(data.birth),
        gender: data.gender,
        prefer_gender: data.prefer_gender,
        budget_min: data.budget.min ? +data.budget.min : null,
        budget_max: data.budget.max ? +data.budget.max : null,
        districts: data.districts,
        move_in: data.move_in,
        lease_months: data.lease_months ? +data.lease_months : null,
      },
    })
      .then((r) => setCountState({ loading: false, value: r.count ?? 0, error: false }))
      .catch(() => setCountState({ loading: false, value: null, error: true }));
  }, [step]);

  function back() {
    haptic();
    setStep((p) => Math.max(0, p - 1));
  }

  function setBirth(part, value) {
    setData((d) => ({ ...d, birth: { ...d.birth, [part]: value } }));
  }
  function setBudget(part, value) {
    const digits = value.replace(/\D/g, "").slice(0, 9);
    setData((d) => ({ ...d, budget: { ...d.budget, [part]: digits } }));
  }

  function pick(v) {
    haptic();
    if (s.key === "gender") setData({ ...data, gender: v });
    else if (s.key === "prefer_gender") setData({ ...data, prefer_gender: v });
    else if (s.key === "districts")
      setData({
        ...data,
        districts:
          v === "Любой"
            ? data.districts.includes("Любой")
              ? []
              : ["Любой"]
            : data.districts.includes(v)
              ? data.districts.filter((x) => x !== v)
              : [...data.districts.filter((x) => x !== "Любой"), v],
      });
    else setData({ ...data, [s.key]: v });
  }

  function toggleMulti(key, v, max) {
    haptic();
    const cur = data[key] || [];
    if (cur.includes(v)) setData({ ...data, [key]: cur.filter((x) => x !== v) });
    else if (cur.length < max) setData({ ...data, [key]: [...cur, v] });
  }

  function onTextInput(e) {
    setData({ ...data, [s.key]: e.target.value });
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
        birthdate: dobISO(data.birth),
        gender: data.gender,
        prefer_gender: data.prefer_gender,
        occupation: data.occupation,
        budget_min: +data.budget.min,
        budget_max: +data.budget.max,
        districts: data.districts,
        move_in: data.move_in,
        lease_months: data.lease_months === "0" || data.lease_months == null ? null : +data.lease_months,
        smoking: data.smoking,
        alcohol: data.alcohol,
        sleep_time: data.sleep_time % 24,
        cleanliness: data.cleanliness,
        guests: data.guests,
        parties: data.parties,
        pets_has: data.pets === "has",
        pets_ok: data.pets !== "no",
        sociability: data.sociability,
        priorities: data.priorities,
        interests: data.interests,
      };
      const saved = await api("/api/me", { method: "POST", body: payload });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (e) {}
      haptic("success");
      onDone(saved);
    } catch (e) {
      haptic("error");
      alertUser(
        e.status === 400 && e.serverMessage
          ? e.serverMessage
          : "Не удалось сохранить анкету. Проверь соединение и попробуй ещё раз."
      );
    } finally {
      setSaving(false);
    }
  }

  const qIndex = STEPS.slice(0, step + 1).filter((x) => x.type !== "count").length;
  const pct = Math.round((qIndex / Q_TOTAL) * 100);

  return (
    <div className="onboard">
      <div className="progress">
        <div style={{ width: pct + "%" }} />
      </div>
      <div className="step-count">
        {step > 0 && (
          <button type="button" className="back-link" onClick={back}>
            ← Назад
          </button>
        )}
        <span>{qIndex} / {Q_TOTAL}</span>
      </div>
      <h1 className="q-title">{s.title}</h1>
      {s.sub && <p className="q-sub">{s.sub}</p>}

      {s.type === "dob" && (
        <>
          <div className="dob-row">
            {[
              ["d", "День", "ДД", Array.from({ length: 31 }, (_, i) => [i + 1, i + 1])],
              ["m", "Месяц", "Месяц", MONTHS.map((n, i) => [i + 1, n])],
              ["y", "Год", "ГГГГ", YEARS.map((y) => [y, y])],
            ].map(([part, label, ph, opts]) => (
              <label className="dob-col" key={part}>
                <span>{label}</span>
                <select
                  className="dob-select"
                  data-empty={!data.birth[part]}
                  value={data.birth[part]}
                  onChange={(e) => setBirth(part, e.target.value)}
                >
                  <option value="" disabled>{ph}</option>
                  {opts.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {dobError && <p className="q-err">{dobError}</p>}
        </>
      )}

      {s.type === "budget" && (
        <>
          <div className="budget-row">
            <label className="dob-col">
              <span>От</span>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={data.budget.min}
                onChange={(e) => setBudget("min", e.target.value)}
              />
            </label>
            <label className="dob-col">
              <span>До</span>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={data.budget.max}
                onChange={(e) => setBudget("max", e.target.value)}
              />
            </label>
          </div>
          {budgetError && <p className="q-err">{budgetError}</p>}
        </>
      )}

      {s.type === "count" && (
        <div className="count-card">
          {countState.loading ? (
            <div className="count-num">…</div>
          ) : countState.error ? (
            <p className="count-sub">Не удалось посчитать — просто продолжай, подберём после анкеты.</p>
          ) : (
            <>
              <div className="count-num">≈ {countState.value}</div>
              <p className="count-sub">
                {countState.value === 0
                  ? "Пока никто не подходит по жёстким критериям. Ответь ещё на пару вопросов — посмотрим шире."
                  : "соседей уже подходят по твоим критериям. Ответь ещё на пару вопросов — подберём точнее."}
              </p>
            </>
          )}
        </div>
      )}

      {s.type === "text" && (
        <input
          className="input"
          type="text"
          placeholder={s.placeholder}
          value={val ?? ""}
          maxLength={s.maxLength}
          autoFocus
          onChange={onTextInput}
          onKeyDown={(e) => e.key === "Enter" && canNext && next()}
        />
      )}

      {s.type === "select" && (
        <select
          className="dob-select"
          data-empty={!val}
          value={val ?? ""}
          onChange={(e) => setData({ ...data, [s.key]: e.target.value })}
        >
          <option value="" disabled>{s.placeholder}</option>
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

      {s.type === "priorities" && (
        <div className="chips">
          {s.options.map(([v, label]) => (
            <button
              key={v}
              className={"chip" + ((val || []).includes(v) ? " active" : "")}
              onClick={() => toggleMulti("priorities", v, s.max)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {s.type === "interests" && (
        <div className="chips">
          {s.options.map(([v]) => (
            <button
              key={v}
              className={"chip" + (val.includes(v) ? " active" : "")}
              onClick={() => toggleMulti("interests", v, 5)}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <button className="next-btn" disabled={!canNext || saving} onClick={next}>
        {saving
          ? "Сохраняем…"
          : s.type === "count"
            ? "Продолжить"
            : step === STEPS.length - 1
              ? "Начать поиск соседей →"
              : "Дальше"}
      </button>
    </div>
  );
}
