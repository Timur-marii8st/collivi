import React, { useEffect, useState } from "react";
import { api, haptic } from "../api";
import Icon from "../Icon";

const SLEEP = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

function ScoreRing({ score }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <div className="score-ring">
      <svg width="56" height="56">
        <circle className="track" cx="28" cy="28" r={r} />
        <circle
          className="val"
          cx="28" cy="28" r={r}
          stroke="var(--btn)"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <div className="score-num">{score}%</div>
    </div>
  );
}

function tagsOf(c) {
  const t = [];
  if (c.budget_min != null && c.budget_max != null)
    t.push(`${c.budget_min.toLocaleString("ru-RU")}–${c.budget_max.toLocaleString("ru-RU")} ₽`);
  else if (c.budget) t.push(`до ${c.budget.toLocaleString("ru-RU")} ₽`);
  if (c.smoking === "no") t.push("не курит");
  if (c.sleep_time != null) t.push(`ложится в ${SLEEP(c.sleep_time)}`);
  if (c.cleanliness >= 7) t.push(`чистота ${c.cleanliness}/10`);
  if (c.guests === "sometimes") t.push("гости иногда");
  if (c.parties === "no") t.push("без вечеринок");
  (c.interests || []).slice(0, 4).forEach((i) => t.push(i));
  return t;
}

export default function Neighbors() {
  const [cands, setCands] = useState(null);
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState(-1); // -1 = ничья карточка не «уезжает»

  const load = () =>
    api("/api/candidates")
      .then((d) => setCands(d.candidates))
      .catch(() => setCands([]));

  useEffect(() => { load(); }, []);

  async function decide(like) {
    const c = cands[idx];
    haptic();
    setLeaving(idx);
    await api("/api/like", { method: "POST", body: { to: c.id, like } }).catch(() => {});
    setTimeout(() => {
      setLeaving(-1);
      setIdx((i) => i + 1);
    }, 180);
  }

  if (!cands) return <div className="empty"><Icon name="loader" className="big" />Ищем…</div>;
  if (!cands.length)
    return (
      <div className="empty">
        <Icon name="sprout" className="big" />
        Пока нет подходящих соседей.
        <br />
        Мы уведомим тебя, когда появятся новые анкеты.
      </div>
    );
  if (idx >= cands.length)
    return (
      <div className="empty">
        <Icon name="check" className="big" />
        Это все анкеты на сегодня!
        <br />
        Загляни позже — новые соседи уже в пути.
      </div>
    );

  const c = cands[idx];
  const isLeaving = leaving === idx;

  return (
    <div style={{ opacity: isLeaving ? 0 : 1, transform: isLeaving ? "scale(.96)" : "none", transition: "all .18s ease" }}>
      <div className="card">
        <div className="card-head">
          <div className="avatar">{(c.first_name?.[0] || "?").toUpperCase()}</div>
          <div style={{ flex: 1 }}>
            <div className="card-name">
              {c.first_name}
              {c.age ? `, ${c.age}` : ""}
            </div>
            <div className="card-sub">{c.occupation || "—"}</div>
          </div>
          <ScoreRing score={c.score} />
        </div>

        {c.reasons[0] && <div className="reason">{c.reasons[0]}</div>}

        <div className="tags">
          {tagsOf(c).map((t) => (
            <span className="tag" key={t}>{t}</span>
          ))}
        </div>

        <div className="actions">
          <button className="act-btn act-no" onClick={() => decide(false)}>Не то</button>
          <button className="act-btn act-yes" onClick={() => decide(true)}>Хочу жить</button>
        </div>
      </div>
      <p style={{ textAlign: "center", color: "var(--hint)", fontSize: 12.5, marginTop: 14 }}>
        При взаимном интересе откроется переписка
      </p>
    </div>
  );
}
