import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import AdminUser from "./AdminUser";
import { money, fmtDate } from "./meta";

const FILTERS = [
  ["all", "Все"],
  ["onboarded", "С анкетой"],
  ["draft", "Черновики"],
  ["in_group", "В группе"],
  ["banned", "Забанены"],
];

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(() => {
    const p = new URLSearchParams({
      filter,
      limit: String(LIMIT),
      offset: String(offset),
    });
    if (q.trim()) p.set("q", q.trim());
    return api(`/api/admin/users?${p}`)
      .then(setData)
      .catch((e) => setErr(String(e.message)));
  }, [q, filter, offset]);

  // поиск с задержкой, чтобы не дёргать сервер на каждую букву
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  if (open)
    return (
      <AdminUser
        tgId={open}
        onClose={() => setOpen(null)}
        onChanged={load}
      />
    );

  return (
    <div>
      <input
        className="input"
        placeholder="Поиск: имя, @username или tg_id"
        value={q}
        onChange={(e) => { setOffset(0); setQ(e.target.value); }}
      />
      <div className="chips adm-chips" style={{ marginTop: 10 }}>
        {FILTERS.map(([v, t]) => (
          <button
            key={v}
            className={"chip adm-chip" + (filter === v ? " active" : "")}
            onClick={() => { setOffset(0); setFilter(v); }}
          >
            {t}
          </button>
        ))}
      </div>

      {err && <div className="adm-error">{err}</div>}

      {!data ? (
        <div className="empty"><div className="big">⏳</div>Загружаем…</div>
      ) : !data.users.length ? (
        <div className="empty"><div className="big">🔍</div>Никого не нашлось</div>
      ) : (
        <>
          <p className="section-title">
            Найдено {data.total} · показано {data.users.length}
          </p>
          {data.users.map((u) => (
            <div
              key={u.tg_id}
              className={"adm-row" + (u.banned ? " banned" : "")}
              onClick={() => setOpen(u.tg_id)}
            >
              <div className="avatar sm">{(u.first_name || "?")[0]}</div>
              <div className="adm-row-main">
                <div className="adm-row-title">
                  {u.first_name || "—"}
                  {u.age ? `, ${u.age}` : ""}
                  {u.banned && <span className="adm-badge red">бан</span>}
                  {!u.onboarded && <span className="adm-badge">черновик</span>}
                  {u.group_id && <span className="adm-badge green">#{u.group_id}</span>}
                </div>
                <div className="adm-row-sub">
                  {u.username ? `@${u.username}` : u.tg_id} · {money(u.budget)} ·{" "}
                  👍{u.likes_sent}/{u.likes_got}
                </div>
                <div className="adm-row-sub">
                  {(u.districts || []).join(", ") || "районы не выбраны"} ·{" "}
                  {fmtDate(u.updated_at)}
                </div>
              </div>
              <span className="adm-chevron">›</span>
            </div>
          ))}
          <div className="adm-pager">
            <button
              className="adm-btn"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              ‹ Назад
            </button>
            <button
              className="adm-btn"
              disabled={offset + LIMIT >= data.total}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Вперёд ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}
