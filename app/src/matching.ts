import { pool } from "./db";

export interface UserRow {
  tg_id: string;
  public_id: string;
  username: string | null;
  first_name: string;
  birthdate: string | null;
  age: number | null;
  gender: string | null;
  prefer_gender: string;
  occupation: string | null;
  budget: number | null;        // legacy / отображение — держим = budget_max
  budget_min: number | null;
  budget_max: number | null;
  districts: string[];
  move_in: string | null;
  lease_months: number | null;  // null = «пока не знаю»
  smoking: string | null;       // yes / no
  alcohol: string | null;       // yes / sometimes / no
  sleep_time: number | null;    // 0-23 час отхода ко сну
  cleanliness: number | null;   // 1-10
  guests: string | null;        // often / sometimes / never
  parties: string | null;       // yes / no
  pets_ok: boolean;
  pets_has: boolean;
  sociability: string | null;   // high / medium / low
  interests: string[];
  priorities: string[];         // quiet / clean / social / budget / schedule
  status: string;               // active / in_group / inactive
  onboarded: boolean;
  banned?: boolean;
  ban_reason?: string | null;
  admin_note?: string | null;
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

/** [min, max] бюджета пользователя, либо null если не задан */
function budgetRange(u: UserRow): [number, number] | null {
  const lo = u.budget_min ?? u.budget;
  const hi = u.budget_max ?? u.budget;
  if (lo == null || hi == null) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** 0 короткий (≤6 мес) · 1 около года · 2 длинный (>18 мес) · null «не знаю» */
function leaseBucket(m: number | null): number | null {
  if (m == null || m <= 0) return null;
  if (m <= 6) return 0;
  if (m <= 18) return 1;
  return 2;
}

/** Жёсткие фильтры. Возвращает строку-причину отказа или null */
export function hardConflict(a: UserRow, b: UserRow): string | null {
  // бюджет — вилки должны пересекаться с относительным допуском
  const ra = budgetRange(a);
  const rb = budgetRange(b);
  if (!ra || !rb) return "budget";
  const tol = Math.max(3000, 0.15 * Math.min(ra[0], rb[0]));
  if (ra[0] > rb[1] + tol || rb[0] > ra[1] + tol) return "budget";

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

  // срок аренды — отказ только на крайнем расхождении (короткий ↔ длинный)
  const la = leaseBucket(a.lease_months);
  const lb = leaseBucket(b.lease_months);
  if (la != null && lb != null && Math.abs(la - lb) >= 2) return "lease";

  // Продуктовое правило main: группы только однополые.
  if (a.gender && b.gender && a.gender !== b.gender) return "gender";

  if (a.smoking === "yes" && b.smoking === "no") return "smoking";
  if (b.smoking === "yes" && a.smoking === "no") return "smoking";
  if (a.pets_has && !b.pets_ok) return "pets";
  if (b.pets_has && !a.pets_ok) return "pets";

  return null;
}

// ---------- скоринг: оси 0..1, потом веса ----------

interface Axis {
  q: number; // 0..1
  label?: string;
}

const BASE_WEIGHTS: Record<string, number> = {
  sleep: 15,
  clean: 15,
  guests: 10,
  parties: 10,
  alcohol: 10,
  social: 10,
  interests: 16,
  age: 6,
  budget: 4,
  lease: 4,
};

// приоритет пользователя -> какие оси усилить
const PRIORITY_AXES: Record<string, string[]> = {
  quiet: ["sleep", "parties", "guests"],
  clean: ["clean"],
  social: ["social", "interests"],
  budget: ["budget"],
  schedule: ["sleep", "lease"],
};

/** Веса осей под приоритеты пользователя `a`, нормированные к сумме 100 */
function weightsFor(priorities: string[]): Record<string, number> {
  const w: Record<string, number> = { ...BASE_WEIGHTS };
  for (const p of priorities || [])
    for (const ax of PRIORITY_AXES[p] || []) w[ax] *= 1.8;
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  for (const k of Object.keys(w)) w[k] = (w[k] / total) * 100;
  return w;
}

function axisSleep(a: UserRow, b: UserRow): Axis {
  if (a.sleep_time == null || b.sleep_time == null) return { q: 0.5 };
  const d = hoursDiff(a.sleep_time, b.sleep_time);
  return { q: Math.max(0, 1 - d / 6), label: d <= 1 ? "совпадает режим сна" : undefined };
}
function axisClean(a: UserRow, b: UserRow): Axis {
  if (a.cleanliness == null || b.cleanliness == null) return { q: 0.5 };
  const d = Math.abs(a.cleanliness - b.cleanliness);
  return { q: Math.max(0, 1 - d / 6), label: d <= 2 ? "похожие стандарты чистоты" : undefined };
}
function axisGuests(a: UserRow, b: UserRow): Axis {
  if (!a.guests || !b.guests) return { q: 0.5 };
  if (a.guests === b.guests)
    return {
      q: 1,
      label: a.guests === "sometimes" || a.guests === "often" ? "одинаково относитесь к гостям" : undefined,
    };
  const opposite =
    (a.guests === "often" && b.guests === "never") ||
    (a.guests === "never" && b.guests === "often");
  return { q: opposite ? 0 : 0.55 };
}
function axisParties(a: UserRow, b: UserRow): Axis {
  if (!a.parties || !b.parties) return { q: 0.5 };
  if (a.parties === b.parties)
    return { q: 1, label: a.parties === "no" ? "оба предпочитаете тишину" : undefined };
  return { q: 0.3 };
}
function axisAlcohol(a: UserRow, b: UserRow): Axis {
  if (!a.alcohol || !b.alcohol) return { q: 0.5 };
  if (a.alcohol === b.alcohol) return { q: 1 };
  if (
    (a.alcohol === "sometimes" || b.alcohol === "sometimes") &&
    a.alcohol !== "no" &&
    b.alcohol !== "no"
  )
    return { q: 0.7 };
  return { q: 0.2 };
}
function axisSocial(a: UserRow, b: UserRow): Axis {
  if (!a.sociability || !b.sociability) return { q: 0.5 };
  if (a.sociability === b.sociability)
    return { q: 1, label: a.sociability === "high" ? "оба открыты к общению" : undefined };
  const order: Record<string, number> = { high: 2, medium: 1, low: 0 };
  const d = Math.abs((order[a.sociability] ?? 1) - (order[b.sociability] ?? 1));
  return { q: d === 1 ? 0.55 : 0.3 };
}
function axisInterests(a: UserRow, b: UserRow): Axis {
  const inter = a.interests.filter((i) => b.interests.includes(i));
  const n = inter.length;
  // затухающая отдача, без штрафа за большой список интересов
  const q = n === 0 ? 0.15 : Math.min(1, 0.35 + 0.22 * n);
  return { q, label: n >= 2 ? `общие интересы: ${inter.slice(0, 3).join(", ")}` : undefined };
}
function axisAge(a: UserRow, b: UserRow): Axis {
  if (!a.age || !b.age) return { q: 0.5 };
  const d = Math.abs(a.age - b.age);
  return { q: Math.max(0, 1 - d / 8), label: d <= 2 ? `ровесники (${a.age})` : undefined };
}
function axisBudget(a: UserRow, b: UserRow): Axis {
  const ra = budgetRange(a);
  const rb = budgetRange(b);
  if (!ra || !rb) return { q: 0.5 };
  const midA = (ra[0] + ra[1]) / 2;
  const midB = (rb[0] + rb[1]) / 2;
  const scale = Math.max(4000, 0.25 * Math.min(midA, midB));
  return { q: Math.max(0, 1 - Math.abs(midA - midB) / scale) };
}
function axisLease(a: UserRow, b: UserRow): Axis {
  const la = leaseBucket(a.lease_months);
  const lb = leaseBucket(b.lease_months);
  if (la == null || lb == null) return { q: 0.5 };
  return { q: la === lb ? 1 : 0.5 };
}

/** Балл совместимости 0..100 с точки зрения пользователя `a` (его приоритеты). */
function softScore(a: UserRow, b: UserRow): { pts: number; label: string } {
  const w = weightsFor(a.priorities || []);
  const axes: Record<string, Axis> = {
    sleep: axisSleep(a, b),
    clean: axisClean(a, b),
    guests: axisGuests(a, b),
    parties: axisParties(a, b),
    alcohol: axisAlcohol(a, b),
    social: axisSocial(a, b),
    interests: axisInterests(a, b),
    age: axisAge(a, b),
    budget: axisBudget(a, b),
    lease: axisLease(a, b),
  };
  let pts = 0;
  const labels: string[] = [];
  for (const k of Object.keys(axes)) {
    pts += axes[k].q * (w[k] || 0);
    if (axes[k].label) labels.push(axes[k].label as string);
  }
  return { pts: Math.round(Math.max(0, Math.min(100, pts))), label: labels.slice(0, 3).join(" · ") };
}

export async function getCandidates(me: UserRow, limit = 20): Promise<Candidate[]> {
  const { rows } = await pool.query<UserRow>(
    `SELECT u.* FROM users u
     WHERE u.tg_id <> $1 AND u.onboarded AND u.status = 'active'
       AND COALESCE(u.banned, FALSE) = FALSE
       AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_tg=$1 AND l.to_tg=u.tg_id)
       AND NOT EXISTS (SELECT 1 FROM dislikes d WHERE d.from_tg=$1 AND d.to_tg=u.tg_id)`,
    [me.tg_id]
  );
  const out: Candidate[] = [];
  for (const u of rows) {
    if (hardConflict(me, u)) continue;
    const s = softScore(me, u);
    out.push({ user: u, score: s.pts, reasons: s.label ? [s.label] : [] });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}

// ---------- предпросмотр количества совпадений во время онбординга ----------

export interface PreviewFilters {
  birthdate?: string | null;
  gender?: string | null;
  prefer_gender?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  districts?: string[];
  move_in?: string | null;
  lease_months?: number | null;
  smoking?: string | null;
  pets_has?: boolean;
  pets_ok?: boolean;
}

export async function previewCount(f: PreviewFilters, excludeTgId?: string): Promise<number> {
  const stub: UserRow = {
    tg_id: "", public_id: "", username: null, first_name: "",
    birthdate: f.birthdate ?? null, age: null,
    gender: f.gender ?? null, prefer_gender: f.prefer_gender ?? "any",
    occupation: null,
    budget: f.budget_max ?? null,
    budget_min: f.budget_min ?? null,
    budget_max: f.budget_max ?? null,
    districts: f.districts ?? [],
    move_in: f.move_in ?? null,
    lease_months: f.lease_months ?? null,
    smoking: f.smoking ?? null, alcohol: null,
    sleep_time: null, cleanliness: null, guests: null, parties: null,
    pets_ok: f.pets_ok ?? true, pets_has: f.pets_has ?? false,
    sociability: null, interests: [], priorities: [],
    status: "active", onboarded: true,
  };
  const { rows } = await pool.query<UserRow>(
    "SELECT * FROM users WHERE onboarded AND status = 'active' AND COALESCE(banned, FALSE) = FALSE AND tg_id <> $1",
    [excludeTgId ?? "0"]
  );
  let n = 0;
  for (const u of rows) if (!hardConflict(stub, u)) n++;
  return n;
}
