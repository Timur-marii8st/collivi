import React, { useEffect, useState } from "react";
import { api } from "./api";
import Onboarding from "./screens/Onboarding";
import Neighbors from "./screens/Neighbors";
import GroupScreen from "./screens/Group";
import Apartments from "./screens/Apartments";
import Profile from "./screens/Profile";

const TABS = [
  { key: "neighbors", ico: "👋", label: "Соседи" },
  { key: "group", ico: "👥", label: "Группа" },
  { key: "apts", ico: "🏠", label: "Квартиры" },
  { key: "profile", ico: "👤", label: "Профиль" },
];

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("neighbors");

  useEffect(() => {
    api("/api/me")
      .then(setMe)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="empty">
        <div className="big">🔑</div>Открываем…
      </div>
    );

  if (!me || !me.onboarded)
    return <Onboarding me={me} onDone={(m) => setMe(m)} />;

  return (
    <div className="app">
      <div className="screen">
        {tab === "neighbors" && <Neighbors />}
        {tab === "group" && <GroupScreen />}
        {tab === "apts" && <Apartments />}
        {tab === "profile" && <Profile me={me} onSaved={setMe} />}
      </div>
      <nav className="tabbar">
        {TABS.map((t) => (
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
