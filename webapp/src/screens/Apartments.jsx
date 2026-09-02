import React, { useEffect, useState } from "react";
import { api, haptic, apiPhotoUrl } from "../api";

export default function Apartments() {
  const [data, setData] = useState(undefined);
  const [marked, setMarked] = useState({});
  const [photos, setPhotos] = useState({}); // apt_id -> objectURL

  useEffect(() => {
    api("/api/apartments").then(setData).catch(() => setData({ apartments: [] }));
  }, []);

  // фото лежат в Telegram (file_id), приложение тянет их через серверный прокси
  useEffect(() => {
    const apts = data?.apartments || [];
    if (!apts.length) return;
    let alive = true;
    for (const a of apts) {
      if (!a.photo_id) continue;
      apiPhotoUrl(`/api/apartments/${a.id}/photo`)
        .then((url) => alive && setPhotos((p) => (p[a.id] ? p : { ...p, [a.id]: url })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [data]);

  async function interest(id) {
    haptic();
    setMarked((m) => ({ ...m, [id]: true }));
    await api(`/api/apartments/${id}/interest`, { method: "POST" }).catch(() => {});
  }

  if (data === undefined)
    return <div className="empty"><div className="big">⏳</div></div>;

  if (data.needGroup)
    return (
      <div className="empty">
        <div className="big">🏠</div>
        Квартиры появляются после того, как вы соберёте группу.
        <br /><br />
        Так мы подбираем варианты точно под ваш общий бюджет.
      </div>
    );

  if (!data.apartments.length)
    return (
      <div className="empty">
        <div className="big">🔍</div>
        Подходящих квартир пока нет — мы уже ищем.
        <br />
        Заглядывай сюда: варианты добавляются регулярно.
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
            {photos[a.id] ? (
              <img src={photos[a.id]} alt="" />
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
