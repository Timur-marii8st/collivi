import React from "react";

const SLEEP = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
const GUESTS = { never: "без гостей", sometimes: "гости иногда", often: "гости свободно" };
const SOCIABILITY = { high: "общительный(ая)", medium: "по настроению", low: "тихий(ая)" };

export default function Profile({ me }) {
  const rows = [
    ["Возраст", me.age],
    ["Занятость", me.occupation],
    ["Бюджет за комнату", me.budget ? `${me.budget.toLocaleString("ru-RU")} ₽` : null],
    ["Районы", me.districts?.join(", ")],
    ["Курение", me.smoking === "yes" ? "курю" : "не курю"],
    ["Сон", me.sleep_time != null ? `ложусь ~${SLEEP(me.sleep_time)}` : null],
    ["Чистота", me.cleanliness ? `${me.cleanliness}/10` : null],
    ["Гости", GUESTS[me.guests]],
    ["Вечеринки", me.parties === "yes" ? "иногда можно" : "дом для отдыха"],
    ["Питомец", me.pets_has ? "есть питомец" : me.pets_ok ? "можно с животными" : "без животных"],
    ["Характер", SOCIABILITY[me.sociability]],
    ["Интересы", me.interests?.join(", ")],
  ].filter(([, v]) => v);

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <div className="avatar">{me.first_name[0]}</div>
          <div>
            <div className="card-name">{me.first_name}</div>
            <div className="card-sub">@{me.username || "—"} · анкета активна ✅</div>
          </div>
        </div>
      </div>
      <p className="section-title">Мои ответы</p>
      <div className="card" style={{ padding: "6px 16px" }}>
        {rows.map(([k, v]) => (
          <div className="p-row" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
      <p style={{ textAlign: "center", color: "var(--hint)", fontSize: 12.5, marginTop: 16 }}>
        Чтобы изменить анкету — напиши нам в боте
      </p>
    </div>
  );
}
