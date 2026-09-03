import React, { useEffect, useState } from "react";
import { api, haptic, alertUser, confirmUser } from "../api";
import Icon from "../Icon";

export default function GroupScreen() {
  const [group, setGroup] = useState(undefined);
  const [conns, setConns] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/api/group").then((g) => setGroup(g || null)).catch(() => setGroup(null));
    api("/api/connections").then((d) => setConns(d.connections)).catch(() => {});
  };
  useEffect(load, []);

  async function createGroup() {
    if (!selected.length) return;
    setBusy(true);
    haptic();
    try {
      await api("/api/group/create", { method: "POST", body: { members: selected } });
      haptic("success");
      setSelected([]);
      load();
    } catch (e) {
      haptic("error");
      alertUser(e.serverMessage || "Не удалось создать группу. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmParticipation() {
    setBusy(true);
    haptic();
    try {
      await api("/api/group/confirm", { method: "POST" });
      haptic("success");
      load();
    } catch (e) {
      haptic("error");
      alertUser("Не удалось подтвердить участие. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    const ok = await confirmUser(
      "Выйти из группы? Если останется меньше двух человек, группа распадётся."
    );
    if (!ok) return;
    setBusy(true);
    haptic();
    try {
      await api("/api/group/leave", { method: "POST" });
      haptic("success");
      load();
    } catch (e) {
      haptic("error");
      alertUser("Не удалось выйти из группы. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (group === undefined)
    return <div className="empty"><Icon name="loader" className="big" /></div>;

  // --- есть группа ---
  if (group) {
    const readyCount = group.members.filter((m) => m.ready).length;
    return (
      <div>
        <div className="card">
          <div className="budget-hero">
            <div className="sum">{group.totalBudget.toLocaleString("ru-RU")} ₽</div>
            <div className="lbl">общий бюджет группы · на человека ≈{" "}
              {Math.floor(group.totalBudget / group.members.length).toLocaleString("ru-RU")} ₽
            </div>
          </div>
          {group.members.map((m) => (
            <div className="member-row" key={m.id}>
              <div className={"ready-dot " + (m.ready ? "on" : "")}>
                {m.ready ? "✓" : "…"}
              </div>
              <div style={{ flex: 1 }}>
                <b>{m.first_name}</b> {m.age ? `· ${m.age}` : ""}
                <div style={{ color: "var(--hint)", fontSize: 13 }}>{m.occupation || ""}</div>
              </div>
              <span style={{ color: "var(--hint)", fontSize: 13.5 }}>
                {m.budget ? `${m.budget.toLocaleString("ru-RU")} ₽` : ""}
              </span>
            </div>
          ))}
        </div>

        {group.status === "forming" && (
          <>
            <p style={{ textAlign: "center", color: "var(--hint)", marginTop: 16, fontSize: 14 }}>
              Ждём подтверждения: {readyCount}/{group.members.length}
            </p>
            {!group.ready && (
              <button
                className="next-btn"
                style={{ marginTop: 14 }}
                disabled={busy}
                onClick={confirmParticipation}
              >
                Подтвердить участие ✓
              </button>
            )}
          </>
        )}
        {group.status === "confirmed" && (
          <div style={{ textAlign: "center", marginTop: 18 }}>
            <p style={{ color: "var(--btn)", fontWeight: 600 }}>Группа собрана</p>
            <p style={{ color: "var(--hint)", fontSize: 13.5, marginTop: 4 }}>
              Смотри вкладку «Квартиры»
            </p>
          </div>
        )}

        <button
          className="act-btn act-no"
          style={{ marginTop: 12, width: "100%" }}
          disabled={busy}
          onClick={leave}
        >
          Выйти из группы
        </button>
      </div>
    );
  }

  // --- группы нет ---
  return (
    <div>
      {!conns.length ? (
        <div className="empty">
          <Icon name="group" className="big" />
          Взаимных лайков пока нет.
          <br />
          Лайкай соседей во вкладке «Соседи» — при взаимном интересе вы сможете собрать группу.
        </div>
      ) : (
        <>
          <p className="section-title" style={{ marginTop: 0 }}>Ваши взаимные лайки</p>
          <p style={{ color: "var(--hint)", fontSize: 13.5, marginBottom: 12 }}>
            Выбери соседей для совместной квартиры (1–3 человека)
          </p>
          {conns.map((c) => (
            <div
              key={c.id}
              className={"conn-card" + (selected.includes(c.id) ? " selected" : "")}
              onClick={() => {
                haptic();
                setSelected((s) =>
                  s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]
                );
              }}
            >
              <div className="avatar" style={{ width: 44, height: 44, fontSize: 18 }}>
                {(c.first_name?.[0] || "?").toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <b>{c.first_name}</b> {c.age ? `· ${c.age}` : ""}
                <div style={{ color: "var(--hint)", fontSize: 13 }}>
                  {c.occupation || "—"} · до {c.budget?.toLocaleString("ru-RU")} ₽
                </div>
              </div>
              <div className={"check-circle" + (selected.includes(c.id) ? " on" : "")}>✓</div>
            </div>
          ))}
          <button
            className="next-btn"
            disabled={!selected.length || busy}
            style={{ marginTop: 10 }}
            onClick={createGroup}
          >
            {busy ? "Создаём…" : `Создать группу (${selected.length + 1} чел.)`}
          </button>
        </>
      )}
    </div>
  );
}
