import React from "react";
import { LABELS } from "./meta";

/**
 * Универсальное поле формы админки.
 * value === undefined трактуется как «не задано».
 */
export default function Field({ def, value, onChange }) {
  const { key, label, type } = def;

  if (type === "bool")
    return (
      <label className="adm-field adm-field-row">
        <span className="adm-label">{label}</span>
        <input
          type="checkbox"
          className="adm-check"
          checked={!!value}
          onChange={(e) => onChange(key, e.target.checked)}
        />
      </label>
    );

  if (type === "enum") {
    const opts =
      typeof def.opts === "string"
        ? Object.entries(LABELS[def.opts] || {})
        : (def.opts || []).map((v) => [v, v]);
    return (
      <div className="adm-field">
        <span className="adm-label">{label}</span>
        <select
          className="input"
          value={value ?? ""}
          onChange={(e) => onChange(key, e.target.value || null)}
        >
          <option value="">— не задано —</option>
          {opts.map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
      </div>
    );
  }

  if (type === "multi") {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (v) =>
      onChange(key, arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    return (
      <div className="adm-field">
        <span className="adm-label">{label}</span>
        <div className="chips adm-chips">
          {(def.opts || []).map((v) => (
            <button
              type="button"
              key={v}
              className={"chip adm-chip" + (arr.includes(v) ? " active" : "")}
              onClick={() => toggle(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="adm-field">
      <span className="adm-label">{label}</span>
      <input
        className="input"
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        inputMode={type === "number" ? "numeric" : "text"}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            key,
            type === "number"
              ? e.target.value === "" ? null : Number(e.target.value)
              : e.target.value
          )
        }
      />
    </div>
  );
}
