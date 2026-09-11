import React, { useEffect, useState } from "react";
import { api, haptic } from "../../api";
import Field from "./Field";
import { APT_FORM, money, label } from "./meta";

const BLANK = { title: "", rooms: 3, price: null, district: "Любой", address: "", contact: "", isolated_rooms: true, status: "available" };

export default function AdminApartments() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // id | "new" | null
  const [draft, setDraft] = useState(BLANK);

  const load = () =>
    api("/api/admin/apartments")
      .then((d) => setList(d.apartments))
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

  const startNew = () => { setDraft(BLANK); setEditing("new"); };
  const startEdit = (a) => {
    setDraft(Object.fromEntries(APT_FORM.map((f) => [f.key, a[f.key]])));
    setEditing(a.id);
  };
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () =>
    act(async () => {
      if (editing === "new")
        await api("/api/admin/apartments", { method: "POST", body: draft });
      else await api(`/api/admin/apartments/${editing}`, { method: "PATCH", body: draft });
      setEditing(null);
    });

  const remove = (id) => {
    if (!window.confirm(`Удалить квартиру #${id}?`)) return;
    act(() => api(`/api/admin/apartments/${id}`, { method: "DELETE" }));
  };

  if (editing !== null)
    return (
      <div className="adm-sheet">
        <div className="adm-sheet-head">
          <button className="adm-back" onClick={() => setEditing(null)}>‹ Назад</button>
        </div>
        <p className="section-title">
          {editing === "new" ? "Новая квартира" : `Квартира #${editing}`}
        </p>
        <div className="card">
          {APT_FORM.map((def) => (
            <Field key={def.key} def={def} value={draft[def.key]} onChange={set} />
          ))}
          <button className="adm-primary wide" disabled={busy} onClick={save}>
            Сохранить
          </button>
        </div>
        {err && <div className="adm-error">{err}</div>}
        <p className="adm-muted" style={{ marginTop: 12 }}>
          Фото прикрепляется в боте: отправь картинку админом — она уйдёт к последней
          созданной квартире.
        </p>
      </div>
    );

  return (
    <div>
      <button className="adm-primary wide" onClick={startNew}>+ Добавить квартиру</button>
      {err && <div className="adm-error">{err}</div>}
      {!list ? (
        <div className="empty"><div className="big">⏳</div>Загружаем…</div>
      ) : !list.length ? (
        <div className="empty"><div className="big">🏠</div>Квартир пока нет</div>
      ) : (
        list.map((a) => (
          <div className="card adm-card" key={a.id}>
            <div className="adm-row-title">
              {a.title}
              <span className="adm-badge">{label("apt_status", a.status)}</span>
              {a.interest > 0 && <span className="adm-badge green">❤ {a.interest}</span>}
            </div>
            <div className="adm-row-sub">
              {a.rooms}-комн · {a.district} · {money(a.price)} (~
              {money(Math.ceil(a.price / Math.max(a.rooms, 1)))}/чел)
            </div>
            <div className="adm-row-sub">{a.address || "адрес не указан"}</div>
            <div className="adm-row-sub">{a.contact || "контакт не указан"}</div>
            <div className="adm-actions">
              <button className="adm-btn" disabled={busy} onClick={() => startEdit(a)}>
                Изменить
              </button>
              <button className="adm-btn danger" disabled={busy} onClick={() => remove(a.id)}>
                Удалить
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
