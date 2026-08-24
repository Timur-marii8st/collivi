import { pool } from "./db";

export interface UserRow {
  tg_id: string;
  username: string | null;
  first_name: string;
  age: number | null;
  gender: string | null;
  prefer_gender: string;
  occupation: string | null;
  budget: number | null;
  districts: string[];
  move_in: string | null;
  lease_months: number;
  smoking: string | null; // yes / no
  alcohol: string | null; // yes / sometimes / no
  sleep_time: number | null; // 0-23 час отхода ко сну
  cleanliness: number | null; // 1-10
  guests: string | null; // often / sometimes / never
  parties: string | null; // yes / no
  pets_ok: boolean;
  pets_has: boolean;
  sociability: string | null; // high / medium / low
  interests: string[];
  onboarded: boolean;
}

export interface Candidate {
  user: UserRow;
  score: number;
  reasons: string[];
}

function hoursDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 24 - d);
}

const MOVE_ORDER = ["week", "twoweeks", "month", "later"];

/** Жёсткие фильтры. Возвращает строку-причину отказа или null */
function hardConflict(a: UserRow, b: UserRow): string | null {
  if (!a.budget || !b.budget) return "budget";
  if (Math.max(a.budget, b.budget) - Math.min(a.budget, b.budget) > 5000)
    return "budget";

  const aAny = a.districts.length === 0 || a.districts.includes("Любой");
  const bAny = b.districts.length === 0 || b.districts.includes("Любой");
  if (!aAny && !bAny && !a.districts.some((d) => b.districts.includes(d)))
    return "district";

  if (
    a.move_in &&
    b.move_in &&
    Math.abs(MOVE_ORDER.indexOf(a.move_in) - MOVE_ORDER.indexOf(b.move_in)) > 1
  )
    return "move_in";

  // строгая однополость: парни только с парнями, девушки только с девушками
  if (a.gender && b.gender && a.gender !== b.gender) return "gender";

  if (a.smoking === "yes" && b.smoking === "no") return "smoking";
  if (b.smoking === "yes" && a.smoking === "no") return "smoking";
  if (a.pets_has && !b.pets_ok) return "pets";
  if (b.pets_has && !a.pets_ok) return "pets";

  return null;
}

interface SoftPart {
  pts: number;
  label?: string;
}

function softScore(a: UserRow, b: UserRow): SoftPart {
  let pts = 0;
  const labels: string[] = [];

  // режим сна — 15
  if (a.sleep_time != null && b.sleep_time != null) {
    const d = hoursDiff(a.sleep_time, b.sleep_time);
    pts += Math.round((15 * Math.max(0, 6 - d)) / 6);
    if (d <= 1) labels.push("совпадает режим сна");
  } else pts += 7;

  // чистота — 15
  if (a.cleanliness != null && b.cleanliness != null) {
    const d = Math.abs(a.cleanliness - b.cleanliness);
    pts += Math.round((15 * Math.max(0, 5 - d)) / 5);
    if (d <= 2) labels.push("похожие стандарты чистоты");
  } else pts += 7;

  // гости — 10
  if (a.guests === b.guests) {
    pts += 10;
    if (a.guests === "sometimes" || a.guests === "often")
      labels.push("одинаково относитесь к гостям");
  } else if (
    (a.guests === "often" && b.guests === "never") ||
    (a.guests === "never" && b.guests === "often")
  ) {
    pts -= 5;
  } else pts += 5;

  // вечеринки — 10
  if (a.parties === b.parties) {
    pts += 10;
    if (a.parties === "no") labels.push("оба предпочитаете тишину");
  } else pts += 3;

  // алкоголь — 10
  if (a.alcohol === b.alcohol) pts += 10;
  else if (
    (a.alcohol === "sometimes" || b.alcohol === "sometimes") &&
    a.alcohol !== "no" &&
    b.alcohol !== "no"
  )
    pts += 7;
  else pts += 2;

  // общительность — 10
  if (a.sociability === b.sociability) {
    pts += 10;
    if (a.sociability === "high") labels.push("оба открыты к общению");
  } else pts += 4;

  // интересы — 20
  const inter = a.interests.filter((i) => b.interests.includes(i));
  const union = new Set([...a.interests, ...b.interests]).size || 1;
  pts += Math.round((20 * inter.length) / union) + (inter.length ? 4 : 0);
  if (inter.length >= 2)
    labels.push(`общие интересы: ${inter.slice(0, 3).join(", ")}`);

  // возраст — 10
  if (a.age && b.age) {
    const d = Math.abs(a.age - b.age);
    pts += Math.round((10 * Math.max(0, 8 - d)) / 8);
    if (d <= 2) labels.push(`ровесники (${a.age})`);
  } else pts += 5;

  return { pts: Math.max(0, Math.min(100, pts)), label: labels.join(" · ") };
}

export async function getCandidates(me: UserRow, limit = 20): Promise<Candidate[]> {
  const { rows } = await pool.query<UserRow>(
    `SELECT u.* FROM users u
     WHERE u.tg_id <> $1 AND u.onboarded AND u.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_tg=$1 AND l.to_tg=u.tg_id)
       AND NOT EXISTS (SELECT 1 FROM dislikes d WHERE d.from_tg=$1 AND d.to_tg=u.tg_id)`,
    [me.tg_id]
  );
  const out: Candidate[] = [];
  for (const u of rows) {
    const conflict = hardConflict(me, u);
    if (conflict) continue;
    const s = softScore(me, u);
    out.push({ user: u, score: s.pts, reasons: s.label ? [s.label] : [] });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}
