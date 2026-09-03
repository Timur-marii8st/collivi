import React from "react";

// Мелкие линейные иконки, цвет — currentColor (следуют теме Telegram).
// Скруглённые концы/стыки — под стиль логотипа. Без сторонних библиотек.
const P = {
  neighbors: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.4 2.9-5.2 5.5-5.2s4.9 1.8 5.5 5.2" />
      <path d="M17.5 4.2v3.2M19.1 5.8h-3.2" />
    </>
  ),
  group: (
    <>
      <circle cx="8" cy="8.5" r="3" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M2.6 19.5c.6-3 2.7-4.6 5.4-4.6s4.8 1.6 5.4 4.6" />
      <path d="M14.8 15.2c1-.7 2.2-1 3.4-.8 2 .3 3.3 1.7 3.7 4.1" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9.8" r="3" />
      <path d="M6.5 18.6c1-2.6 3-4 5.5-4s4.5 1.4 5.5 4" />
    </>
  ),
  sprout: (
    <>
      <path d="M12 21v-8" />
      <path d="M12 13c0-3.2-2-5.5-5.5-5.8C6.8 10.6 8.8 13 12 13Z" />
      <path d="M12 11.5c.2-2.8 2-4.8 5-5-.1 3-2 4.8-5 5Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.6 2.6L16 9.5" />
    </>
  ),
  loader: <path d="M12 3a9 9 0 1 1-6.4 2.6" />,
};

export default function Icon({ name, size = 24, className = "" }) {
  const p = P[name];
  if (!p) return null;
  return (
    <svg
      className={"icon" + (name === "loader" ? " icon-spin" : "") + (className ? " " + className : "")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {p}
    </svg>
  );
}
