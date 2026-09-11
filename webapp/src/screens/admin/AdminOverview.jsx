import React, { useEffect, useState } from "react";
import { api, haptic } from "../../api";
import { fmtDate } from "./meta";

const TILES = [
  ["users_total", "Всего людей"],
  ["users_onboarded", "С анкетой"],
  ["users_week", "Пришли за 7 дней"],
  ["users_in_group", "В группах"],
  ["users_banned", "Заблокировано"],
  ["likes", "Лайков"],
  ["mutual_pairs", "Взаимных пар"],
  ["groups_total", "Групп всего"],
  ["groups_forming", "Собираются"],
  ["groups_confirmed", "Подтверждено"],
  ["apts_total", "Квартир"],
  ["apt_interest", "Заявок на квартиры"],
];

const TARGETS = [
  ["onboarded", "Всем с анкетой"],
  ["no_group", "Только без группы"],
  ["all", "Всем, включая черновики"],
];

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("onboarded");
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api("/api/admin/stats"), api("/api/admin/log?limit=30")])
      .then(([s, l]) => { setStats(s); setLog(l.log); })
      .catch((e) => setErr(String(e.message)));

  useEffect(() => { load(); }, []);

  async function broadcast() {
    const t = TARGETS.find(([v]) => v === target)[1];
    if (!window.confirm(`Отправить рассылку «${t}»?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api("/api/admin/broadcast", {
        method: "POST",
        body: { text, target },
      });
      haptic("success");
      alert(`Доставлено ${r.sent} из ${r.total}`);
      setText("");
      await load();
    } catch (e) {
      haptic("error");
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {err && <div className="adm-error">{err}</div>}

      <div className="adm-tiles">
        {TILES.map(([k, t]) => (
          <div className="adm-tile" key={k}>
            <div className="adm-tile-num">{stats ? stats[k] ?? 0 : "—"}</div>
            <div className="adm-tile-lbl">{t}</div>
          </div>
        ))}
      </div>

      <p className="section-title">Рассылка</p>
      <div className="card">
        <div className="chips adm-chips">
          {TARGETS.map(([v, t]) => (
            <button
              key={v}
              className={"chip adm-chip" + (target === v ? " active" : "")}
              onClick={() => setTarget(v)}
            >
              {t}
            </button>
          ))}
        </div>
        <textarea
          className="input adm-textarea"
          rows={4}
          placeholder="Текст рассылки…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ marginTop: 12 }}
        />
        <button
          className="adm-primary wide"
          disabled={busy || !text.trim()}
          onClick={broadcast}
        >
          {busy ? "Отправляем…" : "Отправить"}
        </button>
      </div>

      <p className="section-title">Журнал действий</p>
      <div className="card">
        {log.length ? (
          log.map((l) => (
            <div className="p-row" key={l.id}>
              <span className="k">
                {l.action} → {l.target}
              </span>
              <span className="v">
                {l.admin_name || l.admin_tg} · {fmtDate(l.created_at)}
              </span>
            </div>
          ))
        ) : (
          <div className="adm-muted">Пока пусто</div>
        )}
      </div>
    </div>
  );
}
