import React, { useEffect, useState } from "react";
import { api, haptic } from "../api";
import Icon from "../Icon";

export default function Apartments() {
  const [data, setData] = useState(undefined);
  const [marked, setMarked] = useState({});

  useEffect(() => {
    api("/api/apartments").then(setData).catch(() => setData({ apartments: [] }));
  }, []);

  async function interest(id) {
    haptic();
    setMarked((m) => ({ ...m, [id]: true }));
    await api(`/api/apartments/${id}/interest`, { method: "POST" }).catch(() => {});
  }

  if (data === undefined)
    return <div className="empty"><Icon name="loader" className="big" /></div>;

  if (data.needGroup)
    return (
      <div className="empty">
        <Icon name="home" className="big" />
        <p className="empty-title">Сначала соберите группу</p>
        <p className="empty-text">Квартиры подбираем под общий бюджет группы</p>
      </div>
    );

  if (!data.apartments.length)
    return (
      <div className="empty">
        <Icon name="search" className="big" />
        <p className="empty-title">Пока ищем варианты</p>
        <p className="empty-text">Пришлём уведомление, как только появится подходящая квартира</p>
      </div>
    );

  return (
    <div>
      <p style={{ color: "var(--hint)", fontSize: 13.5, marginBottom: 12 }}>
        Твой бюджет на комнату:{" "}
        <b style={{ color: "var(--text)" }}>
          до {(data.perPersonBudget || 0).toLocaleString("ru-RU")} ₽
        </b>{" "}
        · вариантов: {data.apartments.length}
      </p>
      {data.apartments.map((a) => (
        <div className="apt-card" key={a.id}>
          <div className="apt-photo">
            {a.photo_url ? (
              <img src={a.photo_url} alt="" />
            ) : a.rooms === 3 ? "🏙" : a.rooms === 4 ? "🏡" : "🏢"}
            <div className="price-badge">{a.price.toLocaleString("ru-RU")} ₽/мес</div>
          </div>
          <div className="apt-body">
            <div className="apt-title">{a.title}</div>
            <div className="apt-meta">
              {a.rooms}-комн · {a.district}{a.address ? ` · ${a.address}` : ""}
              {a.isolated_rooms ? " · отдельные комнаты" : ""}
            </div>
            <div className="apt-foot">
              <span className="per-person">
                ≈ {a.per_person.toLocaleString("ru-RU")} ₽ / чел
                {a.fits ? "" : " ⚠️"}
              </span>
              <button
                className={"mini-btn" + (marked[a.id] ? " done" : "")}
                onClick={() => interest(a.id)}
                disabled={marked[a.id]}
              >
                {marked[a.id] ? "✓ Отмечено" : "Интересно!"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
