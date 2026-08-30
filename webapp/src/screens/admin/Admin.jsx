import React, { useState } from "react";
import AdminOverview from "./AdminOverview";
import AdminUsers from "./AdminUsers";
import AdminGroups from "./AdminGroups";
import AdminApartments from "./AdminApartments";

const SECTIONS = [
  ["overview", "Обзор"],
  ["users", "Люди"],
  ["groups", "Группы"],
  ["apts", "Квартиры"],
];

export default function Admin() {
  const [section, setSection] = useState("overview");

  return (
    <div>
      <div className="adm-nav">
        {SECTIONS.map(([v, t]) => (
          <button
            key={v}
            className={"adm-nav-btn" + (section === v ? " active" : "")}
            onClick={() => setSection(v)}
          >
            {t}
          </button>
        ))}
      </div>
      {section === "overview" && <AdminOverview />}
      {section === "users" && <AdminUsers />}
      {section === "groups" && <AdminGroups />}
      {section === "apts" && <AdminApartments />}
    </div>
  );
}
