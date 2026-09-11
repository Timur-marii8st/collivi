import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db";
import { ADMIN_IDS } from "./config";
import { bot } from "./bot";
import { openAppKeyboard, sendWithFloodRetry, sleep } from "./notify";

export function isAdminId(tgId: number | string): boolean {
  return ADMIN_IDS.includes(Number(tgId));
}

/** Поля анкеты, которые администратору разрешено править */
const EDITABLE = {
  first_name: "text",
  username: "text",
  age: "int",
  birthdate: "date",
  gender: "enum:m,f",
  occupation: "text",
  budget: "int",
  budget_min: "int",
  budget_max: "int",
  districts: "text[]",
  move_in: "enum:week,twoweeks,month,later",
  lease_months: "int",
  smoking: "enum:yes,no",
  alcohol: "enum:yes,sometimes,no",
  sleep_time: "int",
  cleanliness: "int",
  guests: "enum:never,sometimes,often",
  parties: "enum:yes,no",
  pets_ok: "bool",
  pets_has: "bool",
  sociability: "enum:high,medium,low",
  interests: "text[]",
  priorities: "text[]",
  status: "enum:active,in_group",
  onboarded: "bool",
  admin_note: "text",
} as const;

type FieldKind = "text" | "date" | "int" | "bool" | "text[]" | `enum:${string}`;

/** Приводит значение к типу колонки; бросает Error с текстом для 400 */
function coerce(field: string, kind: FieldKind, raw: any): any {
  if (raw === null || raw === "") return null;
  if (kind === "int") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${field}: ожидается число`);
    return Math.trunc(n);
  }
  if (kind === "date") {
    const s = String(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
      throw new Error(`${field}: ожидается дата YYYY-MM-DD`);
    return s;
  }
  if (kind === "bool") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "false") return raw === "true";
    throw new Error(`${field}: ожидается true/false`);
  }
  if (kind === "text") {
    const s = String(raw);
    if (s.length > 300) throw new Error(`${field}: слишком длинное значение`);
    return s;
  }
  if (kind === "text[]") {
    if (!Array.isArray(raw)) throw new Error(`${field}: ожидается массив`);
    if (raw.length > 40) throw new Error(`${field}: слишком много элементов`);
    return raw.map((x) => String(x).slice(0, 100));
  }
  if (kind.startsWith("enum:")) {
    const allowed = kind.slice(5).split(",");
    const s = String(raw);
    if (!allowed.includes(s))
      throw new Error(`${field}: допустимо ${allowed.join(" / ")}`);
    return s;
  }
  throw new Error(`${field}: неизвестный тип`);
}

async function logAction(
  adminTg: number | string,
  action: string,
  target: string,
  details?: any
) {
  await pool
    .query(
      "INSERT INTO admin_log (admin_tg, action, target, details) VALUES ($1,$2,$3,$4)",
      [String(adminTg), action, String(target), details ? JSON.stringify(details) : null]
    )
    .catch(() => {});
}

function adminTg(req: FastifyRequest): string {
  return String((req as any).tgUser.id);
}

async function detachUserFromGroups(
  client: any,
  id: string,
  activeOnly = false
): Promise<number[]> {
  const statusSql = activeOnly
    ? "AND g.status IN ('forming','confirmed','searching')"
    : "";
  const { rows: groups } = await client.query(
    `SELECT g.id
       FROM groups g JOIN group_members gm ON gm.group_id=g.id
       WHERE gm.tg_id=$1 ${statusSql}
       FOR UPDATE OF g`,
    [id]
  );
  const ids = groups.map((g: any) => Number(g.id));
  if (!ids.length) return [];

  await client.query(
    "DELETE FROM group_members WHERE tg_id=$1 AND group_id = ANY($2::int[])",
    [id, ids]
  );

  for (const groupId of ids) {
    const { rows: rest } = await client.query(
      "SELECT tg_id FROM group_members WHERE group_id=$1",
      [groupId]
    );
    if (rest.length < 2) {
      if (rest.length) {
        await client.query(
          "UPDATE users SET status='active' WHERE tg_id = ANY($1::bigint[])",
          [rest.map((x: any) => String(x.tg_id))]
        );
      }
      // explicit cleanup keeps this safe even before/without FK cascade
      await client.query("DELETE FROM apt_interest WHERE group_id=$1", [groupId]);
      await client.query("DELETE FROM group_members WHERE group_id=$1", [groupId]);
      await client.query("DELETE FROM groups WHERE id=$1", [groupId]);
    }
  }
  return ids;
}

export function registerAdminApi(app: FastifyInstance) {
  // все /api/admin/* доступны только из ADMIN_IDS
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/admin")) return;
    const tg = (req as any).tgUser;
    if (!tg || !isAdminId(tg.id))
      return reply.code(403).send({ error: "forbidden" });
  });

  // ---------- сводка ----------

  app.get("/api/admin/stats", async () => {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users_total,
        (SELECT COUNT(*)::int FROM users WHERE onboarded) AS users_onboarded,
        (SELECT COUNT(*)::int FROM users WHERE COALESCE(banned,FALSE)) AS users_banned,
        (SELECT COUNT(*)::int FROM users WHERE status='in_group') AS users_in_group,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '7 days') AS users_week,
        (SELECT COUNT(*)::int FROM likes) AS likes,
        (SELECT COUNT(*)::int FROM dislikes) AS dislikes,
        (SELECT COUNT(*)::int FROM likes a JOIN likes b
           ON a.from_tg=b.to_tg AND a.to_tg=b.from_tg) AS mutual_pairs_x2,
        (SELECT COUNT(*)::int FROM groups) AS groups_total,
        (SELECT COUNT(*)::int FROM groups WHERE status='forming') AS groups_forming,
        (SELECT COUNT(*)::int FROM groups WHERE status='confirmed') AS groups_confirmed,
        (SELECT COUNT(*)::int FROM groups WHERE status='searching') AS groups_searching,
        (SELECT COUNT(*)::int FROM apartments) AS apts_total,
        (SELECT COUNT(*)::int FROM apartments WHERE status='available') AS apts_available,
        (SELECT COUNT(*)::int FROM apt_interest) AS apt_interest
    `);
    const s = rows[0];
    return { ...s, mutual_pairs: Math.floor(s.mutual_pairs_x2 / 2) };
  });

  // ---------- пользователи ----------

  app.get("/api/admin/users", async (req) => {
    const q = req.query as Record<string, string>;
    const search = (q.q || "").trim();
    const filter = q.filter || "all"; // all | onboarded | banned | in_group | draft
    const limit = Math.min(Math.max(parseInt(q.limit || "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset || "0", 10) || 0, 0);
    const sort = q.sort === "created" ? "created_at" : "updated_at";

    const where: string[] = [];
    const vals: any[] = [];
    if (search) {
      vals.push(`%${search.toLowerCase()}%`);
      const p = `$${vals.length}`;
      where.push(
        `(LOWER(COALESCE(first_name,'')) LIKE ${p} OR LOWER(COALESCE(username,'')) LIKE ${p} OR tg_id::text LIKE ${p})`
      );
    }
    if (filter === "onboarded") where.push("onboarded");
    if (filter === "draft") where.push("NOT onboarded");
    if (filter === "banned") where.push("COALESCE(banned,FALSE)");
    if (filter === "in_group") where.push("status='in_group'");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = await pool.query(
      `SELECT COUNT(*)::int n FROM users ${whereSql}`,
      vals
    );
    vals.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT u.*,
              (SELECT COUNT(*)::int FROM likes WHERE from_tg=u.tg_id) AS likes_sent,
              (SELECT COUNT(*)::int FROM likes WHERE to_tg=u.tg_id) AS likes_got,
              (SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id
                 WHERE gm.tg_id=u.tg_id AND g.status IN ('forming','confirmed','searching')
                 LIMIT 1) AS group_id
       FROM users u ${whereSql}
       ORDER BY ${sort} DESC NULLS LAST
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    return { users: rows, total: total.rows[0].n, limit, offset };
  });

  app.get("/api/admin/users/:id", async (req, reply) => {
    const id = String((req.params as any).id);
    const { rows } = await pool.query("SELECT * FROM users WHERE tg_id=$1", [id]);
    if (!rows.length) return reply.code(404).send({ error: "not found" });

    const mutual = await pool.query(
      `SELECT u.tg_id, u.first_name, u.username FROM likes a
       JOIN likes b ON a.from_tg=b.to_tg AND a.to_tg=b.from_tg
       JOIN users u ON u.tg_id=a.to_tg WHERE a.from_tg=$1`,
      [id]
    );
    const groups = await pool.query(
      `SELECT g.id, g.status, gm.ready, gm.joined_at,
              (SELECT STRING_AGG(u2.first_name, ', ') FROM group_members gm2
                 JOIN users u2 ON u2.tg_id=gm2.tg_id WHERE gm2.group_id=g.id) AS names
       FROM group_members gm JOIN groups g ON g.id=gm.group_id
       WHERE gm.tg_id=$1 ORDER BY g.created_at DESC`,
      [id]
    );
    const likes = await pool.query(
      `SELECT 'like' AS kind, to_tg, created_at FROM likes WHERE from_tg=$1
       UNION ALL
       SELECT 'dislike' AS kind, to_tg, created_at FROM dislikes WHERE from_tg=$1
       ORDER BY created_at DESC LIMIT 50`,
      [id]
    );
    return {
      user: rows[0],
      mutual: mutual.rows,
      groups: groups.rows,
      activity: likes.rows,
      editable: EDITABLE,
    };
  });

  // редактирование анкеты
  app.patch("/api/admin/users/:id", async (req, reply) => {
    const id = String((req.params as any).id);
    const body = (req.body || {}) as Record<string, any>;

    const sets: string[] = [];
    const vals: any[] = [id];
    const normalized: Record<string, any> = {};
    try {
      for (const [k, raw] of Object.entries(body)) {
        const kind = (EDITABLE as Record<string, FieldKind>)[k];
        if (!kind) return reply.code(400).send({ error: `поле ${k} недоступно` });
        const value = coerce(k, kind, raw);
        normalized[k] = value;
        vals.push(value);
        sets.push(`${k} = ${vals.length}`);
      }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
    if (!sets.length) return reply.code(400).send({ error: "нет полей" });

    // однополость: используем НОВОЕ значение gender, а не старое значение колонки.
    if (normalized.gender !== undefined) {
      vals.push(normalized.gender);
      sets.push(`prefer_gender = ${vals.length}`);
    }

    // legacy budget остаётся совместимым с новой вилкой.
    if (normalized.budget !== undefined) {
      if (normalized.budget_min === undefined) {
        vals.push(normalized.budget);
        sets.push(`budget_min = ${vals.length}`);
      }
      if (normalized.budget_max === undefined) {
        vals.push(normalized.budget);
        sets.push(`budget_max = ${vals.length}`);
      }
    } else if (normalized.budget_max !== undefined) {
      vals.push(normalized.budget_max);
      sets.push(`budget = ${vals.length}`);
    }
    sets.push("updated_at = NOW()");

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE tg_id=$1 RETURNING *`,
      vals
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    await logAction(adminTg(req), "user_edit", id, body);
    return rows[0];
  });

  // блокировка / разблокировка
  app.post("/api/admin/users/:id/ban", async (req, reply) => {
    const id = String((req.params as any).id);
    const { banned, reason, notify } = (req.body || {}) as {
      banned?: boolean;
      reason?: string;
      notify?: boolean;
    };
    const on = banned !== false;
    const client = await pool.connect();
    let user: any;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `UPDATE users SET banned=$2, ban_reason=$3,
                banned_at=CASE WHEN $2 THEN NOW() ELSE NULL END,
                status=CASE WHEN $2 THEN 'active' ELSE status END,
                updated_at=NOW()
         WHERE tg_id=$1 RETURNING *`,
        [id, on, on ? (reason || "").slice(0, 300) || null : null]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "not found" });
      }
      user = rows[0];

      if (on) {
        await client.query("DELETE FROM likes WHERE from_tg=$1 OR to_tg=$1", [id]);
        await detachUserFromGroups(client, id, true);
      }
      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      return reply.code(500).send({ error: e.message });
    } finally {
      client.release();
    }

    await logAction(adminTg(req), on ? "user_ban" : "user_unban", id, { reason });
    if (notify) {
      const text = on
        ? `🚫 Твой доступ к «Своим» ограничен.${reason ? `\n\nПричина: ${reason}` : ""}`
        : "✅ Доступ к «Своим» восстановлен. Можешь снова открыть приложение.";
      await bot.api
        .sendMessage(id, text, on ? {} : { reply_markup: openAppKeyboard() })
        .catch(() => {});
    }
    return user;
  });

  // удаление учётки со всеми связями
  app.delete("/api/admin/users/:id", async (req, reply) => {
    const id = String((req.params as any).id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT tg_id, first_name FROM users WHERE tg_id=$1",
        [id]
      );
      if (!found.rows.length) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "not found" });
      }

      await client.query("DELETE FROM likes WHERE from_tg=$1 OR to_tg=$1", [id]);
      await client.query("DELETE FROM dislikes WHERE from_tg=$1 OR to_tg=$1", [id]);
      await client.query("DELETE FROM apt_interest WHERE tg_id=$1", [id]);
      await detachUserFromGroups(client, id, false);
      await client.query("DELETE FROM users WHERE tg_id=$1", [id]);
      await client.query("COMMIT");

      await logAction(adminTg(req), "user_delete", id, found.rows[0]);
      return { ok: true };
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      return reply.code(500).send({ error: e.message });
    } finally {
      client.release();
    }
  });

  // личное сообщение пользователю из панели
  app.post("/api/admin/users/:id/message", async (req, reply) => {
    const id = String((req.params as any).id);
    const { text } = (req.body || {}) as { text?: string };
    if (!text || !text.trim())
      return reply.code(400).send({ error: "пустое сообщение" });
    try {
      await bot.api.sendMessage(id, text.slice(0, 4000), {
        reply_markup: openAppKeyboard(),
      });
    } catch (e: any) {
      return reply.code(400).send({ error: `Telegram: ${e.message}` });
    }
    await logAction(adminTg(req), "user_message", id, { text: text.slice(0, 200) });
    return { ok: true };
  });

  // ---------- группы ----------

  app.get("/api/admin/groups", async () => {
    const { rows } = await pool.query(`
      SELECT g.id, g.status, g.apartment_id, g.created_at,
             COUNT(gm.tg_id)::int AS members,
             COUNT(NULLIF(gm.ready, FALSE))::int AS ready,
             COALESCE(SUM(u.budget),0)::int AS budget_total,
             MIN(u.budget)::int AS budget_min,
             JSON_AGG(JSON_BUILD_OBJECT(
               'tg_id', u.tg_id::text, 'first_name', u.first_name,
               'username', u.username, 'budget', u.budget, 'ready', gm.ready
             ) ORDER BY gm.joined_at) AS member_list
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id=g.id
      LEFT JOIN users u ON u.tg_id=gm.tg_id
      GROUP BY g.id ORDER BY g.created_at DESC LIMIT 100
    `);
    return { groups: rows };
  });

  app.patch("/api/admin/groups/:id", async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const { status } = (req.body || {}) as { status?: string };
    if (!status || !["forming", "confirmed", "searching"].includes(status))
      return reply.code(400).send({ error: "status: forming/confirmed/searching" });
    const { rows } = await pool.query(
      "UPDATE groups SET status=$2 WHERE id=$1 RETURNING *",
      [id, status]
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    await logAction(adminTg(req), "group_status", String(id), { status });
    return rows[0];
  });

  app.delete("/api/admin/groups/:id", async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const members = await pool.query(
      "SELECT tg_id FROM group_members WHERE group_id=$1",
      [id]
    );
    await pool.query("DELETE FROM apt_interest WHERE group_id=$1", [id]);
    await pool.query("DELETE FROM group_members WHERE group_id=$1", [id]);
    const { rows } = await pool.query("DELETE FROM groups WHERE id=$1 RETURNING id", [id]);
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    for (const m of members.rows)
      await pool
        .query("UPDATE users SET status='active' WHERE tg_id=$1", [m.tg_id])
        .catch(() => {});
    await logAction(adminTg(req), "group_delete", String(id));
    return { ok: true };
  });

  // ---------- квартиры ----------

  app.get("/api/admin/apartments", async () => {
    const { rows } = await pool.query(`
      SELECT a.*, (SELECT COUNT(*)::int FROM apt_interest WHERE apt_id=a.id) AS interest
      FROM apartments a ORDER BY a.created_at DESC LIMIT 200
    `);
    return { apartments: rows };
  });

  const APT_FIELDS = {
    title: "text",
    rooms: "int",
    price: "int",
    district: "text",
    address: "text",
    contact: "text",
    isolated_rooms: "bool",
    status: "enum:available,offered,rented,hidden",
  } as const;

  app.post("/api/admin/apartments", async (req, reply) => {
    const body = (req.body || {}) as Record<string, any>;
    const cols: string[] = [];
    const vals: any[] = [];
    const ph: string[] = [];
    try {
      for (const [k, kind] of Object.entries(APT_FIELDS)) {
        if (body[k] === undefined) continue;
        vals.push(coerce(k, kind as FieldKind, body[k]));
        cols.push(k);
        ph.push(`$${vals.length}`);
      }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
    if (!cols.includes("title") || !cols.includes("price") || !cols.includes("rooms"))
      return reply.code(400).send({ error: "нужны title, rooms, price" });
    vals.push(adminTg(req));
    cols.push("created_by");
    ph.push(`$${vals.length}`);
    const { rows } = await pool.query(
      `INSERT INTO apartments (${cols.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
      vals
    );
    await logAction(adminTg(req), "apt_create", String(rows[0].id), body);
    return rows[0];
  });

  app.patch("/api/admin/apartments/:id", async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = (req.body || {}) as Record<string, any>;
    const sets: string[] = [];
    const vals: any[] = [id];
    try {
      for (const [k, raw] of Object.entries(body)) {
        const kind = (APT_FIELDS as Record<string, FieldKind>)[k];
        if (!kind) return reply.code(400).send({ error: `поле ${k} недоступно` });
        vals.push(coerce(k, kind, raw));
        sets.push(`${k} = $${vals.length}`);
      }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
    if (!sets.length) return reply.code(400).send({ error: "нет полей" });
    const { rows } = await pool.query(
      `UPDATE apartments SET ${sets.join(", ")} WHERE id=$1 RETURNING *`,
      vals
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    await logAction(adminTg(req), "apt_edit", String(id), body);
    return rows[0];
  });

  app.delete("/api/admin/apartments/:id", async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    await pool.query("DELETE FROM apt_interest WHERE apt_id=$1", [id]);
    await pool.query("UPDATE groups SET apartment_id=NULL WHERE apartment_id=$1", [id]);
    const { rows } = await pool.query(
      "DELETE FROM apartments WHERE id=$1 RETURNING id",
      [id]
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    await logAction(adminTg(req), "apt_delete", String(id));
    return { ok: true };
  });

  // ---------- рассылка ----------

  app.post("/api/admin/broadcast", async (req, reply) => {
    const { text, target } = (req.body || {}) as { text?: string; target?: string };
    if (!text || !text.trim())
      return reply.code(400).send({ error: "пустое сообщение" });
    const where =
      target === "all"
        ? "COALESCE(banned,FALSE) = FALSE"
        : target === "no_group"
        ? "onboarded AND status='active' AND COALESCE(banned,FALSE) = FALSE"
        : "onboarded AND COALESCE(banned,FALSE) = FALSE";
    const { rows } = await pool.query(`SELECT tg_id FROM users WHERE ${where}`);
    let ok = 0;
    for (const r of rows) {
      // Telegram лимитирует рассылки (~30 msg/s, на практике меньше):
      // пауза между отправками + повтор при 429, иначе молча теряем адресатов
      const sent = await sendWithFloodRetry(() =>
        bot.api.sendMessage(r.tg_id, text.slice(0, 4000), {
          reply_markup: openAppKeyboard(),
        })
      );
      if (sent) ok++;
      await sleep(60);
    }
    await logAction(adminTg(req), "broadcast", target || "onboarded", {
      sent: ok,
      total: rows.length,
    });
    return { sent: ok, total: rows.length };
  });

  // ---------- журнал ----------

  app.get("/api/admin/log", async (req) => {
    const limit = Math.min(
      Math.max(parseInt((req.query as any).limit || "50", 10) || 50, 1),
      200
    );
    const { rows } = await pool.query(
      `SELECT l.*, u.first_name AS admin_name FROM admin_log l
       LEFT JOIN users u ON u.tg_id = l.admin_tg
       ORDER BY l.created_at DESC LIMIT $1`,
      [limit]
    );
    return { log: rows };
  });
}
