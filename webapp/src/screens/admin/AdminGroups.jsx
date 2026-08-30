import React, { useEffect, useState } from "react";
import { api, haptic } from "../../api";
import { money, fmtDate, label, LABELS } from "./meta";

export default function AdminGroups() {
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api("/api/admin/groups")
      .then((d) => setGroups(d.groups))
      .catch((e) => setErr(String(e.message)));

  useEffect(() => { load(); }, []);

  async function act(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      haptic("success");
      await load();
    } catch (e) {
      haptic("error");
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (id, status) =>
    act(() => api(`/api/admin/groups/${id}`, { method: "PATCH", body: { status } }));

  const remove = (id) => {
    if (!window.confirm(`Расформировать группу #${id}?`)) return;
    act(() => api(`/api/admin/groups/${id}`, { method: "DELETE" }));
  };

  if (err) return <div className="adm-error">{err}</div>;
  if (!groups) return <div className="empty"><div className="big">⏳</div>Загружаем…</div>;
  if (!groups.length)
    return <div className="empty"><div className="big">👥</div>Групп пока нет</div>;

  return (
    <div>
      {groups.map((g) => (
        <div className="card adm-card" key={g.id}>
          <div className="adm-row-title">
            Группа #{g.id}
            <span className="adm-badge green">{label("group_status", g.status)}</span>
            <span className="adm-badge">
              {g.ready}/{g.members} готовы
            </span>
          </div>
          <div className="adm-row-sub">
            Общий бюджет {money(g.budget_total)} · минимум {money(g.budget_min)} ·{" "}
            {fmtDate(g.created_at)}
          </div>
          <div className="adm-members">
            {(g.member_list || [])
              .filter((m) => m && m.tg_id)
              .map((m) => (
                <div className="p-row" key={m.tg_id}>
                  <span className="k">
                    {m.ready ? "✅" : "⏳"} {m.first_name || m.tg_id}
                  </span>
                  <span className="v">
                    {m.username ? `@${m.username}` : m.tg_id} · {money(m.budget)}
                  </span>
                </div>
              ))}
          </div>
          <div className="adm-actions">
            <select
              className="input"
              value={g.status}
              disabled={busy}
              onChange={(e) => setStatus(g.id, e.target.value)}
            >
              {Object.entries(LABELS.group_status).map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </select>
            <button className="adm-btn danger" disabled={busy} onClick={() => remove(g.id)}>
              Расформировать
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
