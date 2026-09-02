import React, { useEffect, useState } from "react";
import { api } from "./api";
import Onboarding from "./screens/Onboarding";
import Neighbors from "./screens/Neighbors";
import GroupScreen from "./screens/Group";
import Apartments from "./screens/Apartments";
import Profile from "./screens/Profile";
import Admin from "./screens/admin/Admin";

const TABS = [
  { key: "neighbors", ico: "👋", label: "Соседи" },
  { key: "group", ico: "👥", label: "Группа" },
  { key: "apts", ico: "🏠", label: "Квартиры" },
  { key: "profile", ico: "👤", label: "Профиль" },
];
const ADMIN_TAB = { key: "admin", ico: "⚙️", label: "Админка" };

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [banned, setBanned] = useState(null);
  const [tab, setTab] = useState("neighbors");
  const [editingProfile, setEditingProfile] = useState(false);

  const loadMe = () => {
    setLoading(true);
    setLoadError(false);
    api("/api/me")
      .then((m) => {
        setMe(m);
        // админ без анкеты сразу попадает в панель
        if (m?.is_admin && !m?.onboarded) setTab("admin");
      })
      .catch((e) => {
        if (String(e.message) === "banned") setBanned(true);
        // любой другой сбой (сеть, 500, истёкший initData) — это НЕ «анкеты нет»:
        // показывать онбординг заново уже прошедшему его человеку нельзя
        else setLoadError(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(loadMe, []);

  if (loading)
    return (
      <div className="empty">
        <div className="big">🔑</div>Открываем…
      </div>
    );

  if (banned)
    return (
      <div className="empty">
        <div className="big">🚫</div>
        Доступ к «Своим» ограничен. Если это ошибка — напиши нам в боте.
      </div>
    );

  if (loadError)
    return (
      <div className="empty">
        <div className="big">⚠️</div>
        Не удалось загрузить данные.
        Проверь соединение и попробуй снова — или открой приложение заново через бота.
        <button className="next-btn" style={{ marginTop: 18 }} onClick={loadMe}>
          Попробовать снова
        </button>
      </div>
    );

  const isAdmin = !!me?.is_admin;

  // обычный пользователь без анкеты идёт в онбординг; админ — нет
  if ((!me || !me.onboarded) && !isAdmin)
    return <Onboarding onDone={(m) => setMe(m)} />;

  // редактирование анкеты: тот же онбординг, но с уже заполненными полями
  if (editingProfile)
    return (
      <Onboarding
        initial={me}
        onCancel={() => setEditingProfile(false)}
        onDone={(m) => {
          setMe(m);
          setEditingProfile(false);
        }}
      />
    );

  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS;
  const needOnboarding = !me?.onboarded;

  return (
    <div className="app">
      <div className="screen">
        {tab === "admin" && <Admin />}
        {tab !== "admin" && needOnboarding && (
          <div className="empty">
            <div className="big">📝</div>
            Твоя анкета не заполнена, поэтому пользовательские экраны пустые.
            Заполнить её можно позже — админ-панель доступна во вкладке «Админка».
          </div>
        )}
        {tab !== "admin" && !needOnboarding && (
          <>
            {tab === "neighbors" && <Neighbors />}
            {tab === "group" && <GroupScreen />}
            {tab === "apts" && <Apartments />}
            {tab === "profile" && (
              <Profile
                me={me}
                onSaved={setMe}
                onEdit={() => setEditingProfile(true)}
              />
            )}
          </>
        )}
      </div>
      <nav className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={"tab" + (tab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}
          >
            <span className="ico">{t.ico}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
