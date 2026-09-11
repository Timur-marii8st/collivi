import React, { useEffect, useState } from "react";
import { api, haptic } from "../../api";
import Field from "./Field";
import { USER_FORM, money, fmtDate, label } from "./meta";

export default function AdminUser({ tgId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState("");

  const load = () =>
    api(`/api/admin/users/${tgId}`)
      .then((d) => {
        setData(d);
        setDraft({});
      })
      .catch((e) => setErr(String(e.message)));

  useEffect(() => { load(); }, [tgId]);

  if (err) return <div className="empty"><div className="big">⚠️</div>{err}</div>;
  if (!data) return <div className="empty"><div className="big">⏳</div>Загружаем…</div>;

  const u = data.user;
  const val = (k) => (k in draft ? draft[k] : u[k]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = Object.keys(draft).length > 0;

  async function run(fn, okMsg) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      haptic("success");
      if (okMsg) alert(okMsg);
      await load();
      onChanged?.();
    } catch (e) {
      haptic("error");
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(() => api(`/api/admin/users/${tgId}`, { method: "PATCH", body: draft }));

  const toggleBan = () => {
    const on = !u.banned;
    const reason = on
      ? window.prompt("Причина блокировки (можно оставить пустым):", "") ?? null
      : null;
    if (on && reason === null) return;
    const notify = window.confirm(
      on ? "Уведомить пользователя о блокировке?" : "Уведомить о разблокировке?"
    );
    run(() =>
      api(`/api/admin/users/${tgId}/ban`, {
        method: "POST",
        body: { banned: on, reason, notify },
      })
    );
  };

  const remove = () => {
    if (!window.confirm(`Удалить учётку ${u.first_name} (${u.tg_id}) навсегда?`)) return;
    if (!window.confirm("Точно? Лайки, группы и заявки тоже будут удалены.")) return;
    run(async () => {
      await api(`/api/admin/users/${tgId}`, { method: "DELETE" });
      onChanged?.();
      onClose();
    });
  };

  const send = () => {
    if (!msg.trim()) return;
    run(
      () =>
        api(`/api/admin/users/${tgId}/message`, {
          method: "POST",
          body: { text: msg },
        }),
      "Отправлено"
    ).then(() => setMsg(""));
  };

  return (
    <div className="adm-sheet">
      <div className="adm-sheet-head">
        <button className="adm-back" onClick={onClose}>‹ Назад</button>
        {dirty && (
          <button className="adm-primary" disabled={busy} onClick={save}>
            Сохранить
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="avatar">{(u.first_name || "?")[0]}</div>
          <div>
            <div className="card-name">
              {u.first_name || "—"} {u.banned && <span className="adm-badge red">заблокирован</span>}
            </div>
            <div className="card-sub">
              {u.username ? `@${u.username}` : "без username"} · id {u.tg_id}
            </div>
          </div>
        </div>
        <div className="adm-kv">
          <div><span>Статус</span><b>{label("status", u.status)}</b></div>
          <div><span>Анкета</span><b>{u.onboarded ? "заполнена" : "черновик"}</b></div>
          <div><span>Бюджет</span><b>{money(u.budget)}</b></div>
          <div><span>Регистрация</span><b>{fmtDate(u.created_at)}</b></div>
          <div><span>Обновлена</span><b>{fmtDate(u.updated_at)}</b></div>
          {u.banned && (
            <div><span>Причина бана</span><b>{u.ban_reason || "—"}</b></div>
          )}
        </div>
        <div className="adm-actions">
          <button className={u.banned ? "adm-btn" : "adm-btn warn"} disabled={busy} onClick={toggleBan}>
            {u.banned ? "Разблокировать" : "Заблокировать"}
          </button>
          <button className="adm-btn danger" disabled={busy} onClick={remove}>
            Удалить
          </button>
        </div>
      </div>

      <p className="section-title">Написать в Telegram</p>
      <div className="card">
        <textarea
          className="input adm-textarea"
          rows={3}
          placeholder="Текст сообщения…"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
        <button className="adm-primary wide" disabled={busy || !msg.trim()} onClick={send}>
          Отправить
        </button>
      </div>

      <p className="section-title">Анкета</p>
      <div className="card">
        {USER_FORM.map((def) => (
          <Field key={def.key} def={def} value={val(def.key)} onChange={set} />
        ))}
        <button className="adm-primary wide" disabled={busy || !dirty} onClick={save}>
          {dirty ? "Сохранить изменения" : "Изменений нет"}
        </button>
      </div>

      <p className="section-title">Мэтчи ({data.mutual.length})</p>
      <div className="card">
        {data.mutual.length ? (
          data.mutual.map((m) => (
            <div className="p-row" key={m.tg_id}>
              <span className="k">{m.first_name}</span>
              <span className="v">{m.username ? `@${m.username}` : m.tg_id}</span>
            </div>
          ))
        ) : (
          <div className="adm-muted">Взаимных лайков нет</div>
        )}
      </div>

      <p className="section-title">Группы ({data.groups.length})</p>
      <div className="card">
        {data.groups.length ? (
          data.groups.map((g) => (
            <div className="p-row" key={g.id}>
              <span className="k">#{g.id} · {label("group_status", g.status)}</span>
              <span className="v">{g.names} {g.ready ? "✅" : "⏳"}</span>
            </div>
          ))
        ) : (
          <div className="adm-muted">Групп нет</div>
        )}
      </div>

      <p className="section-title">Последняя активность</p>
      <div className="card">
        {data.activity.length ? (
          data.activity.map((a, i) => (
            <div className="p-row" key={i}>
              <span className="k">{a.kind === "like" ? "👍" : "👎"} {a.to_tg}</span>
              <span className="v">{fmtDate(a.created_at)}</span>
            </div>
          ))
        ) : (
          <div className="adm-muted">Нет действий</div>
        )}
      </div>

      {err && <div className="adm-error">{err}</div>}
    </div>
  );
}
