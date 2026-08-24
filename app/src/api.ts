import { FastifyInstance } from "fastify";
import { pool } from "./db";
import { validateInitData } from "./auth";
import { getCandidates, UserRow } from "./matching";
import { notifyMutualLike, notifyGroupInvite, openAppKeyboard } from "./notify";
import { bot } from "./bot";

async function getUser(tgId: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    "SELECT * FROM users WHERE tg_id = $1",
    [tgId]
  );
  return rows[0] || null;
}

export function registerApi(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    reply.code(500).send({ error: "internal", detail: err.message });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/health") return;
    const initData = (req.headers["x-init-data"] as string) || "";
    const user = validateInitData(initData);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    (req as any).tgUser = user;
  });

  // сохранить/обновить анкету
  app.post("/api/me", async (req, reply) => {
    const tg = (req as any).tgUser;
    const p = req.body as Partial<UserRow>;
    // принудительная однополость: prefer_gender всегда совпадает с gender
    if ((p as any).gender) (p as any).prefer_gender = (p as any).gender;

    // валидация
    if (p.age !== undefined) {
      const a = Number(p.age);
      if (!Number.isInteger(a) || a < 16 || a > 60)
        return reply.code(400).send({ error: "age 16-60" });
    }
    if (p.budget !== undefined) {
      const b = Number(p.budget);
      if (!Number.isInteger(b) || b < 5000 || b > 200000)
        return reply.code(400).send({ error: "budget 5k-200k" });
    }
    if (p.gender !== undefined && !["m", "f"].includes(String(p.gender)))
      return reply.code(400).send({ error: "gender" });
    if (p.occupation !== undefined && String(p.occupation).length > 80)
      return reply.code(400).send({ error: "occupation too long" });
    if (p.districts !== undefined && !Array.isArray(p.districts))
      return reply.code(400).send({ error: "districts" });
    await pool.query(
      `INSERT INTO users (tg_id, username, first_name) VALUES ($1,$2,$3)
       ON CONFLICT (tg_id) DO UPDATE SET updated_at = NOW()`,
      [tg.id, tg.username || null, tg.first_name || null]
    );
    const fields = [
      "age", "gender", "prefer_gender", "occupation", "budget",
      "districts", "move_in", "lease_months", "smoking", "alcohol",
      "sleep_time", "cleanliness", "guests", "parties",
      "pets_ok", "pets_has", "sociability", "interests",
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    fields.forEach((f) => {
      if ((p as any)[f] !== undefined) {
        vals.push((p as any)[f]);
        sets.push(`${f} = $${vals.length}`);
      }
    });
    if (sets.length) {
      // sync Telegram profile (if provided)
      if (tg.first_name) {
        vals.push(tg.first_name);
        sets.push(`first_name = COALESCE(NULLIF($${vals.length}::text, ''), first_name)`);
      }
      if (tg.username) {
        vals.push(tg.username);
        sets.push(`username = COALESCE($${vals.length}, username)`);
      }
      sets.push(`onboarded = TRUE`);
      sets.push(`updated_at = NOW()`);
      vals.push(tg.id);
      await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE tg_id = $${vals.length}`, vals);
    }
    return getUser(tg.id);
  });

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
        tg_id: c.user.tg_id,
        first_name: c.user.first_name,
        age: c.user.age,
        occupation: c.user.occupation,
        budget: c.user.budget,
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

  // лайк / дизлайк
  app.post("/api/like", async (req, reply) => {
    const me = String((req as any).tgUser.id);
    const { to, like } = req.body as { to: string; like: boolean };
    if (to === me) return reply.code(400).send({ error: "self" });
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
        const other = await getUser(to);
        if (other)
          notifyMutualLike(bot, { tg_id: to, first_name: other.first_name }, { tg_id: me, first_name: (req as any).tgUser.first_name })
            .catch(() => {});
        notifyMutualLike(
          bot,
          { tg_id: me, first_name: (req as any).tgUser.first_name || "сосед" },
          { tg_id: to, first_name: other?.first_name || "сосед" }
        ).catch(() => {});
        return { mutual: true };
      }
    }
    return { mutual: false };
  });

  // взаимные лайки
  app.get("/api/connections", async (req) => {
    const me = String((req as any).tgUser.id);
    const { rows } = await pool.query(
      `SELECT u.tg_id, u.first_name, u.age, u.occupation, u.budget
       FROM likes a JOIN likes b ON a.from_tg=b.to_tg AND a.to_tg=b.from_tg
       JOIN users u ON u.tg_id = a.to_tg
       WHERE a.from_tg = $1`,
      [me]
    );
    return { connections: rows };
  });

  // создать группу из взаимных лайков
  app.post("/api/group/create", async (req, reply) => {
    const me = String((req as any).tgUser.id);
    const { members } = req.body as { members: string[] };
    if (!members.length || members.length > 3)
      return reply.code(400).send({ error: "1-3 соседа" });
    const all = [me, ...members];
    for (const m of members) {
      const { rows } = await pool.query(
        "SELECT 1 FROM likes a JOIN likes b ON a.from_tg=b.to_tg AND a.to_tg=b.from_tg WHERE a.from_tg=$1 AND b.from_tg=$2",
        [me, m]
      );
      if (!rows.length) return reply.code(400).send({ error: "нет взаимного мэтча" });
    }
    // у участника не должно быть активной группы
    for (const id of all) {
      const { rows } = await pool.query(
        `SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
         WHERE gm.tg_id=$1 AND g.status IN ('forming','confirmed')`,
        [id]
      );
      if (rows.length) return reply.code(400).send({ error: "у кого-то уже есть группа" });
    }
    const { rows } = await pool.query(
      "INSERT INTO groups DEFAULT VALUES RETURNING id"
    );
    const groupId = rows[0].id;
    for (const id of all)
      await pool.query(
        "INSERT INTO group_members (group_id, tg_id, ready) VALUES ($1,$2,$3)",
        [groupId, id, id === me]
      );

    const creator = await getUser(me);
    for (const m of members)
      notifyGroupInvite(bot, m, creator?.first_name || "Сосед", groupId).catch(() => {});
    return { groupId };
  });

  // моя группа
  app.get("/api/group", async (req) => {
    const me = String((req as any).tgUser.id);
    const { rows } = await pool.query(
      `SELECT g.id, g.status, g.apartment_id, gm.ready FROM groups g
       JOIN group_members gm ON gm.group_id=g.id
       WHERE g.status IN ('forming','confirmed','searching')
         AND g.id IN (SELECT group_id FROM group_members WHERE tg_id=$1)`,
      [me]
    );
    if (!rows.length) return null;
    const g = rows[0];
    const members = await pool.query(
      `SELECT u.tg_id, u.first_name, u.age, u.occupation, u.budget, gm.ready
       FROM group_members gm JOIN users u ON u.tg_id=gm.tg_id WHERE gm.group_id=$1`,
      [g.id]
    );
    const budget = members.rows.reduce((s, m) => s + (m.budget || 0), 0);
    let apartment = null;
    if (g.apartment_id) {
      const a = await pool.query("SELECT * FROM apartments WHERE id=$1", [
        g.apartment_id,
      ]);
      apartment = a.rows[0] || null;
    }
    return { ...g, members: members.rows, totalBudget: budget, apartment };
  });

  // подтвердить участие в группе (из бота или приложения)
  app.post("/api/group/confirm", async (req) => {
    const me = String((req as any).tgUser.id);
    await pool.query(
      "UPDATE group_members SET ready=TRUE WHERE tg_id=$1",
      [me]
    );
    return { ok: true };
  });

  // выйти из группы
  app.post("/api/group/leave", async (req) => {
    const me = String((req as any).tgUser.id);
    const { rows } = await pool.query(
      `DELETE FROM group_members WHERE tg_id=$1 AND group_id IN
        (SELECT id FROM groups WHERE status IN ('forming')) RETURNING group_id`,
      [me]
    );
    if (rows.length)
      await pool.query(
        "UPDATE users SET status='active' WHERE tg_id=$1",
        [me]
      );
    return { ok: true };
  });

  // лента квартир под группу
  app.get("/api/apartments", async (req) => {
    const me = String((req as any).tgUser.id);
    const grp = await pool.query(
      `SELECT g.* FROM groups g WHERE g.status IN ('confirmed','searching')
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
    const perPersonMax = Math.floor(grp.rows[0].status === 'searching' ? minBudget : minBudget);
    const districts = new Set<string>();
    members.rows.forEach((m) => (m.districts || []).forEach((d: string) => districts.add(d)));
    const hasAny = districts.has("Любой") || districts.size === 0;

    const { rows } = await pool.query(
      `SELECT * FROM apartments WHERE status='available'
       AND price / GREATEST(rooms - 0, 1) <= $1 + 3000
       ORDER BY created_at DESC LIMIT 30`,
      [minBudget]
    );
    const filtered = rows.filter(
      (a) =>
        hasAny ||
        districts.has(a.district) ||
        a.district === "Любой"
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
    const aptId = parseInt((req.params as any).id, 10);
    const grp = await pool.query(
      `SELECT group_id FROM group_members WHERE tg_id=$1 LIMIT 1`,
      [me]
    );
    if (!grp.rows.length) return reply.code(400).send({ error: "нет группы" });
    await pool.query(
      `INSERT INTO apt_interest (apt_id, group_id, tg_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [aptId, grp.rows[0].group_id, me]
    );
    return { ok: true };
  });
}
