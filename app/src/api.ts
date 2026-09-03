import { FastifyInstance } from "fastify";
import { pool } from "./db";
import { validateInitData } from "./auth";
import { getCandidates, hardConflict, previewCount, UserRow } from "./matching";
import {
  notifyMutualLike,
  notifyGroupInvite,
  notifyGroupMemberLeft,
} from "./notify";
import { bot, checkGroupComplete } from "./bot";

async function getUser(tgId: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    "SELECT * FROM users WHERE tg_id = $1",
    [tgId]
  );
  return rows[0] || null;
}

/** Непрозрачный public_id из ответов API → внутренний tg_id. null, если не найден. */
async function publicToTgId(publicId: unknown): Promise<string | null> {
  if (typeof publicId !== "string" || !/^[0-9a-f-]{36}$/i.test(publicId))
    return null;
  const { rows } = await pool.query(
    "SELECT tg_id FROM users WHERE public_id = $1",
    [publicId]
  );
  return rows[0] ? String(rows[0].tg_id) : null;
}

// ---------- валидация анкеты ----------

const GENDERS = ["m", "f"];
const PREFER = ["any", "mixed", "m", "f"];
const MOVE_IN = ["week", "twoweeks", "month", "later"];
const YES_NO = ["yes", "no"];
const ALCOHOL = ["yes", "sometimes", "no"];
const GUESTS = ["never", "sometimes", "often"];
const SOCIABILITY = ["high", "medium", "low"];
const DISTRICTS = [
  "Вахитовский", "Советский", "Приволжский", "Авиастроительный",
  "Ново-Савиновский", "Московский", "Кировский", "Любой",
];
const INTERESTS = [
  "спорт", "игры", "музыка", "кино", "готовка", "путешествия",
  "чтение", "программирование", "танцы", "фото", "аниме", "авто",
];
const PRIORITIES = ["quiet", "clean", "social", "budget", "schedule"];

const ALLOWED_FIELDS = new Set([
  "age", "birthdate", "gender", "prefer_gender", "occupation",
  "budget", "budget_min", "budget_max", "districts",
  "move_in", "lease_months", "smoking", "alcohol", "sleep_time", "cleanliness",
  "guests", "parties", "pets_ok", "pets_has", "sociability", "interests", "priorities",
]);

type Patch = Record<string, unknown>;

function toInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+$/.test(v.trim()))
    return parseInt(v.trim(), 10);
  return undefined;
}

/** Разбор и валидация тела POST /api/me. Возвращает либо {value}, либо {error}. */
function parseProfile(body: unknown): { value?: Patch; error?: string } {
  if (!body || typeof body !== "object") return { error: "тело запроса должно быть объектом" };
  const b = body as Record<string, unknown>;
  const out: Patch = {};

  const enumField = (key: string, allowed: string[]) => {
    if (!(key in b)) return null;
    const v = typeof b[key] === "string" ? (b[key] as string).trim() : "";
    if (!allowed.includes(v)) return `${key}: недопустимое значение`;
    out[key] = v;
    return null;
  };
  const boolField = (key: string) => {
    if (!(key in b)) return null;
    if (typeof b[key] !== "boolean") return `${key}: ожидается true/false`;
    out[key] = b[key];
    return null;
  };
  const intField = (key: string, min: number, max: number) => {
    if (!(key in b)) return null;
    const n = toInt(b[key]);
    if (n === undefined || n < min || n > max) return `${key}: значение должно быть от ${min} до ${max}`;
    out[key] = n;
    return null;
  };

  let e: string | null;

  if ("age" in b) {
    const a = toInt(b.age);
    if (a === undefined || a < 18) return { error: "Возраст — от 18 лет" };
    out.age = a;
  }
  if ("birthdate" in b) {
    const raw = typeof b.birthdate === "string" ? b.birthdate.trim() : "";
    const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!md) return { error: "Неверная дата рождения" };
    const [, ys, ms, ds] = md;
    const y = +ys, mo = +ms, da = +ds;
    const dt = new Date(Date.UTC(y, mo - 1, da));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== da)
      return { error: "Такой даты не существует" };
    const now = new Date();
    if (y < 1900 || dt.getTime() > now.getTime())
      return { error: "Неверная дата рождения" };
    let age = now.getUTCFullYear() - y;
    if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < da))
      age--;
    if (age < 18) return { error: "Регистрация с 18 лет" };
    out.birthdate = raw;
    out.age = age;
  }
  if ((e = intField("budget", 0, 10_000_000))) return { error: "Бюджет вне допустимого диапазона" };
  if ("budget_min" in b || "budget_max" in b) {
    const lo = toInt(b.budget_min);
    const hi = toInt(b.budget_max);
    if (lo === undefined || hi === undefined || lo < 0 || hi < 0 || hi > 10_000_000)
      return { error: "Укажи бюджет от и до" };
    if (lo > hi) return { error: "«От» не может быть больше «до»" };
    out.budget_min = lo;
    out.budget_max = hi;
    out.budget = hi; // legacy / отображение
  }
  if ((e = intField("sleep_time", 0, 27))) return { error: e };
  if ((e = intField("cleanliness", 1, 10))) return { error: e };
  if ("lease_months" in b) {
    if (b.lease_months === null || b.lease_months === "" || b.lease_months === 0) {
      out.lease_months = null; // «пока не знаю»
    } else if ((e = intField("lease_months", 1, 36))) {
      return { error: e };
    }
  }
  if ((e = enumField("gender", GENDERS))) return { error: e };
  if ((e = enumField("prefer_gender", PREFER))) return { error: e };
  if ((e = enumField("move_in", MOVE_IN))) return { error: e };
  if ((e = enumField("smoking", YES_NO))) return { error: e };
  if ((e = enumField("alcohol", ALCOHOL))) return { error: e };
  if ((e = enumField("guests", GUESTS))) return { error: e };
  if ((e = enumField("parties", YES_NO))) return { error: e };
  if ((e = enumField("sociability", SOCIABILITY))) return { error: e };
  if ((e = boolField("pets_ok"))) return { error: e };
  if ((e = boolField("pets_has"))) return { error: e };

  if ("occupation" in b) {
    const o = typeof b.occupation === "string" ? b.occupation.trim() : "";
    if (!o || o.length > 120) return { error: "Занятость: до 120 символов" };
    out.occupation = o;
  }
  if ("districts" in b) {
    if (!Array.isArray(b.districts)) return { error: "districts: ожидается список" };
    const d = [...new Set(b.districts)].filter(
      (x): x is string => typeof x === "string" && DISTRICTS.includes(x)
    );
    if (!d.length || d.length > DISTRICTS.length) return { error: "Выбери хотя бы один район" };
    out.districts = d;
  }
  if ("interests" in b) {
    if (!Array.isArray(b.interests)) return { error: "interests: ожидается список" };
    const it = [...new Set(b.interests)].filter(
      (x): x is string => typeof x === "string" && INTERESTS.includes(x)
    );
    if (it.length > 5) return { error: "Не больше 5 интересов" };
    out.interests = it;
  }
  if ("priorities" in b) {
    if (!Array.isArray(b.priorities)) return { error: "priorities: ожидается список" };
    const pr = [...new Set(b.priorities)].filter(
      (x): x is string => typeof x === "string" && PRIORITIES.includes(x)
    );
    if (pr.length > 3) return { error: "Не больше 3 приоритетов" };
    out.priorities = pr;
  }

  return { value: out };
}

// ---------- маршруты ----------

export function registerApi(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/health") return;
    const initData = (req.headers["x-init-data"] as string) || "";
    const user = validateInitData(initData);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    (req as any).tgUser = user;
  });

  app.get("/api/health", async () => ({ ok: true }));

  // сохранить/обновить анкету
  app.post(
    "/api/me",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const tg = (req as any).tgUser;
      const { value: patch, error } = parseProfile(req.body);
      if (error || !patch) return reply.code(400).send({ error: error || "bad body" });

      await pool.query(
        `INSERT INTO users (tg_id, username, first_name) VALUES ($1,$2,$3)
         ON CONFLICT (tg_id) DO UPDATE SET
           username = COALESCE(EXCLUDED.username, users.username),
           first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
           updated_at = NOW()`,
        [tg.id, tg.username || null, tg.first_name || null]
      );

      const keys = Object.keys(patch).filter((k) => ALLOWED_FIELDS.has(k));
      if (keys.length) {
        const sets = keys.map((k, i) => `${k} = $${i + 1}`);
        const params: unknown[] = keys.map((k) => patch[k]);
        // onboarded=TRUE только когда собраны ключевые поля
        const complete = ["age", "gender", "budget", "districts"].every((k) =>
          keys.includes(k)
        );
        if (complete) sets.push("onboarded = TRUE");
        sets.push("updated_at = NOW()");
        params.push(tg.id);
        await pool.query(
          `UPDATE users SET ${sets.join(", ")} WHERE tg_id = $${params.length}`,
          params
        );
      }
      return getUser(tg.id);
    }
  );

  app.get("/api/me", async (req) => {
    const tg = (req as any).tgUser;
    return getUser(tg.id);
  });

  // карточки соседей
  app.get("/api/candidates", async (req) => {
    const me = await getUser(String((req as any).tgUser.id));
    if (!me || !me.onboarded) return { candidates: [] };
    const cands = await getCandidates(me);
    return {
      candidates: cands.map((c) => ({
        id: c.user.public_id, // наружу отдаём public_id, не tg_id
        first_name: c.user.first_name,
        age: c.user.age,
        occupation: c.user.occupation,
        budget: c.user.budget,
        budget_min: c.user.budget_min,
        budget_max: c.user.budget_max,
        districts: c.user.districts,
        smoking: c.user.smoking,
        sleep_time: c.user.sleep_time,
        cleanliness: c.user.cleanliness,
        guests: c.user.guests,
        parties: c.user.parties,
        sociability: c.user.sociability,
        interests: c.user.interests,
        score: c.score,
        reasons: c.reasons,
      })),
    };
  });

  // сколько соседей проходит по жёстким фильтрам — показываем в середине онбординга.
  // ничего не сохраняет, доступно до заполнения анкеты.
  app.post(
    "/api/candidates/preview",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const b = (req.body || {}) as Record<string, unknown>;
      const asStr = (v: unknown) => (typeof v === "string" ? v : undefined);
      const asInt = (v: unknown) => {
        const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
        return Number.isFinite(n) ? n : undefined;
      };
      const count = await previewCount({
        birthdate: asStr(b.birthdate) ?? null,
        gender: asStr(b.gender) ?? null,
        prefer_gender: asStr(b.prefer_gender) ?? null,
        budget_min: asInt(b.budget_min) ?? null,
        budget_max: asInt(b.budget_max) ?? null,
        districts: Array.isArray(b.districts)
          ? (b.districts.filter((x) => typeof x === "string") as string[])
          : [],
        move_in: asStr(b.move_in) ?? null,
        lease_months: asInt(b.lease_months) ?? null,
        smoking: asStr(b.smoking) ?? null,
      }, String((req as any).tgUser.id));
      return { count };
    }
  );

  // лайк / дизлайк
  app.post(
    "/api/like",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = String((req as any).tgUser.id);
      const body = (req.body || {}) as { to?: unknown; like?: unknown };
      const like = body.like === true;

      const to = await publicToTgId(body.to);
      if (!to) return reply.code(400).send({ error: "неизвестный профиль" });
      if (to === me) return reply.code(400).send({ error: "нельзя оценить себя" });

      // лайкать можно только того, кто реально проходит в подбор
      const meRow = await getUser(me);
      if (!meRow || !meRow.onboarded)
        return reply.code(403).send({ error: "сначала заполни анкету" });
      const target = await getUser(to);
      if (!target || !target.onboarded || target.status !== "active")
        return reply.code(403).send({ error: "профиль недоступен" });
      if (hardConflict(meRow, target))
        return reply.code(403).send({ error: "профиль не проходит по жёстким фильтрам" });

      await pool.query(
        `INSERT INTO ${like ? "likes" : "dislikes"} (from_tg, to_tg) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [me, to]
      );

      if (like) {
        const { rows } = await pool.query(
          "SELECT 1 FROM likes WHERE from_tg=$1 AND to_tg=$2",
          [to, me]
        );
        if (rows.length) {
          const myName = (req as any).tgUser.first_name || "сосед";
          notifyMutualLike(
            bot,
            { tg_id: to, first_name: target.first_name },
            { tg_id: me, first_name: myName }
          ).catch(() => {});
          notifyMutualLike(
            bot,
            { tg_id: me, first_name: myName },
            { tg_id: to, first_name: target.first_name }
          ).catch(() => {});
          return { mutual: true };
        }
      }
      return { mutual: false };
    }
  );

  // взаимные лайки
  app.get("/api/connections", async (req) => {
    const me = String((req as any).tgUser.id);
    const { rows } = await pool.query(
      `SELECT u.public_id AS id, u.first_name, u.age, u.occupation, u.budget
       FROM likes a JOIN likes b ON a.from_tg=b.to_tg AND a.to_tg=b.from_tg
       JOIN users u ON u.tg_id = a.to_tg
       WHERE a.from_tg = $1`,
      [me]
    );
    return { connections: rows };
  });

  // создать группу из взаимных лайков
  app.post(
    "/api/group/create",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = String((req as any).tgUser.id);
      const raw = (req.body as any)?.members;
      if (!Array.isArray(raw))
        return reply.code(400).send({ error: "members должен быть списком" });

      // public_id -> tg_id, без дублей и без самого себя
      const resolved = await Promise.all(raw.map((m) => publicToTgId(m)));
      if (resolved.some((r) => r === null))
        return reply.code(400).send({ error: "среди выбранных есть неизвестный профиль" });
      const members = [...new Set(resolved as string[])].filter((m) => m !== me);
      if (members.length < 1 || members.length > 3)
        return reply.code(400).send({ error: "выбери от 1 до 3 соседей" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        for (const m of members) {
          const { rows } = await client.query(
            `SELECT 1 FROM likes a JOIN likes b
               ON a.from_tg=b.to_tg AND a.to_tg=b.from_tg
             WHERE a.from_tg=$1 AND b.from_tg=$2`,
            [me, m]
          );
          if (!rows.length) {
            await client.query("ROLLBACK");
            return reply.code(400).send({ error: "нет взаимного мэтча с кем-то из выбранных" });
          }
        }
        for (const id of [me, ...members]) {
          const { rows } = await client.query(
            `SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
             WHERE gm.tg_id=$1 AND g.status IN ('forming','confirmed','searching')`,
            [id]
          );
          if (rows.length) {
            await client.query("ROLLBACK");
            return reply.code(400).send({ error: "у кого-то из вас уже есть активная группа" });
          }
        }

        const { rows } = await client.query(
          "INSERT INTO groups DEFAULT VALUES RETURNING id"
        );
        const groupId = rows[0].id;
        for (const id of [me, ...members])
          await client.query(
            "INSERT INTO group_members (group_id, tg_id, ready) VALUES ($1,$2,$3)",
            [groupId, id, id === me]
          );

        await client.query("COMMIT");

        const creator = await getUser(me);
        for (const m of members)
          notifyGroupInvite(bot, m, creator?.first_name || "Сосед", groupId).catch(() => {});
        return { groupId };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        req.log.error(err);
        return reply.code(500).send({ error: "не удалось создать группу" });
      } finally {
        client.release();
      }
    }
  );

  // моя группа
  app.get("/api/group", async (req) => {
    const me = String((req as any).tgUser.id);
    const { rows } = await pool.query(
      `SELECT g.id, g.status, g.apartment_id, gm.ready FROM groups g
       JOIN group_members gm ON gm.group_id=g.id AND gm.tg_id=$1
       WHERE g.status IN ('forming','confirmed','searching')`,
      [me]
    );
    if (!rows.length) return null;
    const g = rows[0];
    const members = await pool.query(
      `SELECT u.public_id AS id, u.first_name, u.age, u.occupation, u.budget, gm.ready
       FROM group_members gm JOIN users u ON u.tg_id=gm.tg_id WHERE gm.group_id=$1`,
      [g.id]
    );
    const budget = members.rows.reduce((s, m) => s + (m.budget || 0), 0);
    let apartment = null;
    if (g.apartment_id) {
      const a = await pool.query(
        `SELECT id, title, rooms, price, district, address, isolated_rooms, photo_id, status
         FROM apartments WHERE id=$1`,
        [g.apartment_id]
      );
      apartment = a.rows[0] || null;
    }
    return { ...g, members: members.rows, totalBudget: budget, apartment };
  });

  // подтвердить участие в группе (из бота или приложения)
  app.post("/api/group/confirm", async (req, reply) => {
    const me = String((req as any).tgUser.id);
    const { rows } = await pool.query(
      `UPDATE group_members SET ready=TRUE
       WHERE tg_id=$1
         AND group_id IN (SELECT id FROM groups WHERE status='forming')
       RETURNING group_id`,
      [me]
    );
    if (!rows.length)
      return reply.code(404).send({ error: "нет формирующейся группы" });
    // ready уже сохранён; сбор группы + уведомления не должны валить запрос
    await checkGroupComplete(rows[0].group_id).catch((e) => req.log.error(e));
    return { ok: true };
  });

  // выйти из группы
  app.post("/api/group/leave", async (req, reply) => {
    const me = String((req as any).tgUser.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `DELETE FROM group_members
         WHERE tg_id=$1 AND group_id IN
           (SELECT id FROM groups WHERE status IN ('forming','confirmed','searching'))
         RETURNING group_id`,
        [me]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return { ok: true, disbanded: false };
      }
      const groupId = rows[0].group_id;
      await client.query("UPDATE users SET status='active' WHERE tg_id=$1", [me]);

      const { rows: rest } = await client.query(
        "SELECT tg_id FROM group_members WHERE group_id=$1",
        [groupId]
      );
      const disbanded = rest.length < 2;
      if (disbanded) {
        await client.query(
          "UPDATE users SET status='active' WHERE tg_id IN (SELECT tg_id FROM group_members WHERE group_id=$1)",
          [groupId]
        );
        await client.query("DELETE FROM group_members WHERE group_id=$1", [groupId]);
        await client.query("DELETE FROM groups WHERE id=$1", [groupId]);
      }
      await client.query("COMMIT");

      const whoLeft = (req as any).tgUser.first_name || "Сосед";
      for (const r of rest)
        notifyGroupMemberLeft(bot, String(r.tg_id), whoLeft).catch(() => {});
      return { ok: true, disbanded };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      req.log.error(err);
      return reply.code(500).send({ error: "не удалось выйти из группы" });
    } finally {
      client.release();
    }
  });

  // лента квартир под группу
  app.get("/api/apartments", async (req) => {
    const me = String((req as any).tgUser.id);
    const grp = await pool.query(
      `SELECT g.id FROM groups g WHERE g.status IN ('confirmed','searching')
       AND g.id IN (SELECT group_id FROM group_members WHERE tg_id=$1) LIMIT 1`,
      [me]
    );
    if (!grp.rows.length) return { apartments: [], needGroup: true };

    const members = await pool.query(
      `SELECT u.budget, u.districts FROM group_members gm
       JOIN users u ON u.tg_id=gm.tg_id WHERE gm.group_id=$1`,
      [grp.rows[0].id]
    );
    const minBudget = Math.min(...members.rows.map((m) => m.budget || 0));
    const districts = new Set<string>();
    members.rows.forEach((m) =>
      (m.districts || []).forEach((d: string) => districts.add(d))
    );
    const hasAny = districts.has("Любой") || districts.size === 0;

    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.rooms, a.price, a.district, a.address, a.isolated_rooms,
              a.photo_id, a.status,
              (ai.tg_id IS NOT NULL) AS interested
       FROM apartments a
       LEFT JOIN apt_interest ai ON ai.apt_id = a.id AND ai.tg_id = $2
       WHERE a.status='available' AND a.price / GREATEST(a.rooms, 1) <= $1 + 3000
       ORDER BY a.created_at DESC LIMIT 30`,
      [minBudget, me]
    );
    const filtered = rows.filter(
      (a) => hasAny || districts.has(a.district) || a.district === "Любой"
    );
    return {
      apartments: filtered.map((a) => ({
        ...a,
        per_person: Math.ceil(a.price / a.rooms),
        fits: Math.ceil(a.price / a.rooms) <= minBudget,
      })),
      perPersonBudget: minBudget,
    };
  });

  // интерес к квартире
  app.post("/api/apartments/:id/interest", async (req, reply) => {
    const me = String((req as any).tgUser.id);
    const aptId = Number((req.params as any).id);
    if (!Number.isInteger(aptId) || aptId <= 0)
      return reply.code(400).send({ error: "некорректный id квартиры" });

    const apt = await pool.query("SELECT 1 FROM apartments WHERE id=$1", [aptId]);
    if (!apt.rows.length)
      return reply.code(404).send({ error: "квартира не найдена" });

    const grp = await pool.query(
      `SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id
       WHERE gm.tg_id=$1 AND g.status IN ('confirmed','searching') LIMIT 1`,
      [me]
    );
    if (!grp.rows.length)
      return reply.code(400).send({ error: "нужна собранная группа" });

    await pool.query(
      `INSERT INTO apt_interest (apt_id, group_id, tg_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [aptId, grp.rows[0].group_id, me]
    );
    return { ok: true };
  });
}
