import { Hono, type Context } from "hono";
import { HttpError, newId, nowIso, readJson, requireUser, text, type AppEnv, type Env } from "@openact/core/server";
import { addDays, isDate, isTime, localDate, readLimits, wallClock, weekday, type UpcomingShift } from "../shared/rules.ts";
import { MAX_RANGE_DAYS, MAX_REPEAT_WEEKS, overlaps, shiftDate, shiftTimes, type ScheduleData, type ShiftInfo, type ShiftStatus } from "../shared/schedule.ts";
import { loadAccess, locationPunches, locationRow, requireManage, shiftsOf, toLocation, type Access, type LocationRow } from "./store.ts";

/*
 * WorkSpent schedules, under /api/apps/workspent/companies/:id. Managers of a location plan its shifts.
 * A new or changed shift is a draft until a manager publishes it. published_json keeps what staff see.
 * A person cannot have two shifts at the same time, at any location of the company.
 */

export const scheduleRoutes = new Hono<AppEnv>();

const UUIDISH = /^[0-9a-f-]{36}$/;

interface ShiftRow {
  id: string;
  company_id: string;
  location_id: string;
  person_id: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  note: string;
  series_key: string | null;
  published_json: string | null;
  is_deleted: number;
}

const snapshot = (r: Pick<ShiftRow, "person_id" | "starts_at" | "ends_at" | "break_minutes" | "note">) =>
  JSON.stringify({ personId: r.person_id, startsAt: r.starts_at, endsAt: r.ends_at, breakMinutes: r.break_minutes, note: r.note });

function statusOf(r: ShiftRow): ShiftStatus {
  if (r.is_deleted) return "deleted";
  if (!r.published_json) return "draft";
  return r.published_json === snapshot(r) ? "published" : "changed";
}

const toShift = (r: ShiftRow): ShiftInfo => ({
  id: r.id,
  personId: r.person_id,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  breakMinutes: r.break_minutes,
  note: r.note,
  status: statusOf(r),
  seriesKey: r.series_key
});

async function ctx(c: Context<AppEnv>, lid?: string): Promise<{ companyId: string; access: Access; loc: LocationRow | null }> {
  const user = requireUser(c);
  const companyId = c.req.param("id")!;
  const access = await loadAccess(c.env, companyId, user.id);
  if (lid === undefined) return { companyId, access, loc: null };
  if (!UUIDISH.test(lid)) throw new HttpError(404, "This location does not exist.");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  return { companyId, access, loc };
}

/** Shift rows of a location whose local date is in the range. Reads a day more on each side for time zones. */
async function rowsInRange(env: Env, loc: LocationRow, from: string, to: string): Promise<ShiftRow[]> {
  const rows = await env.DB.prepare("SELECT * FROM workspent_shifts WHERE company_id = ? AND location_id = ? AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at")
    .bind(loc.company_id, loc.id, addDays(from, -1) + "T00:00:00.000Z", addDays(to, 1) + "T23:59:59.999Z")
    .all<ShiftRow>();
  return rows.results.filter((r) => {
    const d = shiftDate(r.starts_at, loc.time_zone);
    return d >= from && d <= to;
  });
}

function readRange(c: Context<AppEnv>, body?: Record<string, unknown>): { from: string; to: string } {
  const from = (body?.from ?? c.req.query("from")) as unknown;
  const to = (body?.to ?? c.req.query("to")) as unknown;
  if (!isDate(from) || !isDate(to) || to < from) throw new HttpError(400, "Send from and to as dates like 2026-11-22, with to on or after from.");
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_RANGE_DAYS) throw new HttpError(400, `A schedule range can be ${MAX_RANGE_DAYS} days at most.`);
  return { from, to };
}

/** The person of a shift: in the company and on. Empty means an open shift. */
async function checkPerson(env: Env, companyId: string, v: unknown): Promise<string | null> {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !UUIDISH.test(v)) throw new HttpError(404, "This person does not exist. They may belong to another company.");
  const p = await env.DB.prepare("SELECT is_active FROM workspent_people WHERE id = ? AND company_id = ?").bind(v, companyId).first<{ is_active: number }>();
  if (!p) throw new HttpError(404, "This person does not exist. They may belong to another company.");
  if (!p.is_active) throw new HttpError(409, "This person is turned off in People and PINs. Turn them on first.");
  return v;
}

function readBreak(v: unknown, lengthMin: number): number {
  const n = v === undefined || v === null || v === "" ? 0 : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 120) throw new HttpError(400, "A meal break is 0 to 120 minutes.");
  if (n >= lengthMin) throw new HttpError(400, "The meal break must be shorter than the shift.");
  return n;
}

function readTimes(loc: LocationRow, body: Record<string, unknown>): { startsAt: string; endsAt: string } {
  if (!isDate(body.date) || !isTime(body.startTime) || !isTime(body.endTime))
    throw new HttpError(400, "A shift needs a date like 2026-11-24, and a start and an end time like 07:00.");
  const t = shiftTimes(body.date, body.startTime, body.endTime, loc.time_zone);
  if ("problem" in t) throw new HttpError(400, t.problem);
  return t;
}

/** Refuses a shift that overlaps another shift of the same person, at any location of the company. */
async function checkOverlap(env: Env, companyId: string, personId: string | null, t: { startsAt: string; endsAt: string }, exceptId: string | null, alsoNew: Array<{ startsAt: string; endsAt: string }> = []) {
  if (!personId) return;
  const rows = await env.DB.prepare(
    `SELECT s.starts_at, s.ends_at, l.name AS location_name, l.time_zone FROM workspent_shifts s JOIN workspent_locations l ON l.id = s.location_id
     WHERE s.company_id = ? AND s.person_id = ? AND s.is_deleted = 0 AND s.id != ? AND s.starts_at < ? AND s.ends_at > ?`
  )
    .bind(companyId, personId, exceptId ?? "", t.endsAt, t.startsAt)
    .all<{ starts_at: string; ends_at: string; location_name: string; time_zone: string }>();
  const clash = rows.results[0];
  if (clash) {
    const w = wallClock(Date.parse(clash.starts_at), clash.time_zone);
    throw new HttpError(409, `This person already has a shift at that time: ${w.date} at ${w.time}, ${clash.location_name}. Change one of the shifts.`, "overlap");
  }
  if (alsoNew.some((o) => overlaps(o, t))) throw new HttpError(409, "Two of these shifts overlap. Change the times.", "overlap");
}

/* Read ----------------------------------------------------------------- */

scheduleRoutes.get("/companies/:id/locations/:lid/schedule", async (c) => {
  const { companyId, access, loc } = await ctx(c, c.req.param("lid"));
  const l = loc!;
  const { from, to } = readRange(c);
  const now = Date.now();
  const rows = await rowsInRange(c.env, l, from, to);
  // Clock-ins in the range, for the day view and for hours worked.
  const punches = await locationPunches(c.env, companyId, l.id, { start: from, end: to });
  const worked = [...shiftsOf(punches, l.time_zone, l.flags_json, now).values()]
    .flat()
    .filter((s) => s.date >= from && s.date <= to)
    .map((s) => ({ personId: s.personId, date: s.date, inAt: s.inAt, outAt: s.outAt, open: s.open, minutes: s.minutes }));
  const clockIns = punches.filter((p) => p.kind === "in" && !p.is_deleted).map((p) => ({ personId: p.person_id, at: p.punched_at }));
  const ids = new Set(rows.map((r) => r.person_id).filter((x): x is string => !!x));
  for (const w of worked) ids.add(w.personId);
  const people = await c.env.DB.prepare(
    `SELECT DISTINCT p.id, p.name, p.is_active FROM workspent_people p LEFT JOIN workspent_person_locations pl ON pl.person_id = p.id AND pl.location_id = ?
     WHERE p.company_id = ? AND (pl.location_id IS NOT NULL AND p.is_active = 1 ${ids.size ? `OR p.id IN (${[...ids].map(() => "?").join(",")})` : ""}) ORDER BY p.name COLLATE NOCASE`
  )
    .bind(l.id, companyId, ...ids)
    .all<{ id: string; name: string; is_active: number }>();
  const shifts = rows.map(toShift);
  const data: ScheduleData = {
    location: toLocation(l, true),
    from,
    to,
    today: localDate(now, l.time_zone),
    now: new Date(now).toISOString(),
    weekLimitMinutes: Math.round(readLimits(l.flags_json).weekHours * 60),
    people: people.results.map((p) => ({ id: p.id, name: p.name, isActive: p.is_active === 1 })),
    shifts,
    worked,
    clockIns,
    unpublished: shifts.filter((s) => s.status !== "published").length,
    canSetup: access.setup
  };
  return c.json(data);
});

/* Write ---------------------------------------------------------------- */

/** Adds a shift, and its weekly repeats. Each one starts as a draft. */
scheduleRoutes.post("/companies/:id/locations/:lid/schedule", async (c) => {
  const { companyId, access, loc } = await ctx(c, c.req.param("lid"));
  const l = loc!;
  if (l.is_archived) throw new HttpError(409, "This location is archived. Bring it back first.");
  const body = await readJson(c);
  const personId = await checkPerson(c.env, companyId, body.personId);
  const first = readTimes(l, body);
  const breakMinutes = readBreak(body.breakMinutes, (Date.parse(first.endsAt) - Date.parse(first.startsAt)) / 60_000);
  const note = text(body.note, "Note", { max: 200 });
  const repeat = body.repeatWeeks ?? 0;
  if (typeof repeat !== "number" || !Number.isInteger(repeat) || repeat < 0 || repeat > MAX_REPEAT_WEEKS)
    throw new HttpError(400, `A shift can repeat for 0 to ${MAX_REPEAT_WEEKS} more weeks.`);
  const list: Array<{ startsAt: string; endsAt: string }> = [];
  for (let k = 0; k <= repeat; k++) {
    const t = readTimes(l, { ...body, date: addDays(body.date as string, 7 * k) });
    await checkOverlap(c.env, companyId, personId, t, null, list);
    list.push(t);
  }
  const series = repeat ? newId() : null;
  const now = nowIso();
  const ids = list.map(() => newId());
  await c.env.DB.batch(
    list.map((t, i) =>
      c.env.DB.prepare(
        `INSERT INTO workspent_shifts (id, company_id, location_id, person_id, starts_at, ends_at, break_minutes, note, series_key, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(ids[i], companyId, l.id, personId, t.startsAt, t.endsAt, breakMinutes, note, series, access.userId, now, now)
    )
  );
  return c.json({ ids }, 201);
});

async function shiftFor(c: Context<AppEnv>) {
  const { companyId, access } = await ctx(c);
  const sid = c.req.param("sid") ?? "";
  if (!UUIDISH.test(sid)) throw new HttpError(404, "This shift does not exist.");
  const row = await c.env.DB.prepare("SELECT * FROM workspent_shifts WHERE id = ? AND company_id = ?").bind(sid, companyId).first<ShiftRow>();
  if (!row) throw new HttpError(404, "This shift does not exist. It may belong to another company.");
  requireManage(access, row.location_id);
  const loc = await locationRow(c.env, companyId, row.location_id);
  if (row.is_deleted) throw new HttpError(409, "This shift is deleted. Add a new one instead.");
  return { companyId, access, row, loc };
}

/** Changes a shift. A published shift shows as changed until a manager publishes it again. */
scheduleRoutes.patch("/companies/:id/schedule/:sid", async (c) => {
  const { companyId, row, loc } = await shiftFor(c);
  const body = await readJson(c);
  const personId = body.personId !== undefined ? await checkPerson(c.env, companyId, body.personId) : row.person_id;
  const t = body.date !== undefined || body.startTime !== undefined || body.endTime !== undefined ? readTimes(loc, body) : { startsAt: row.starts_at, endsAt: row.ends_at };
  const breakMinutes = body.breakMinutes !== undefined ? readBreak(body.breakMinutes, (Date.parse(t.endsAt) - Date.parse(t.startsAt)) / 60_000) : row.break_minutes;
  if (breakMinutes >= (Date.parse(t.endsAt) - Date.parse(t.startsAt)) / 60_000) throw new HttpError(400, "The meal break must be shorter than the shift.");
  const note = body.note !== undefined ? text(body.note, "Note", { max: 200 }) : row.note;
  await checkOverlap(c.env, companyId, personId, t, row.id);
  await c.env.DB.prepare("UPDATE workspent_shifts SET person_id = ?, starts_at = ?, ends_at = ?, break_minutes = ?, note = ?, updated_at = ? WHERE id = ? AND company_id = ?")
    .bind(personId, t.startsAt, t.endsAt, breakMinutes, note, nowIso(), row.id, companyId)
    .run();
  const next = await c.env.DB.prepare("SELECT * FROM workspent_shifts WHERE id = ?").bind(row.id).first<ShiftRow>();
  return c.json({ shift: toShift(next!) });
});

/** Deletes a shift. A draft goes at once. A published shift stays for staff until a manager publishes the change. */
scheduleRoutes.delete("/companies/:id/schedule/:sid", async (c) => {
  const { companyId, row } = await shiftFor(c);
  if (!row.published_json) await c.env.DB.prepare("DELETE FROM workspent_shifts WHERE id = ? AND company_id = ?").bind(row.id, companyId).run();
  else await c.env.DB.prepare("UPDATE workspent_shifts SET is_deleted = 1, updated_at = ? WHERE id = ? AND company_id = ?").bind(nowIso(), row.id, companyId).run();
  return c.json({ ok: true });
});

/** Publishes every change in a range: drafts, changed shifts and deleted shifts. */
scheduleRoutes.post("/companies/:id/locations/:lid/schedule/publish", async (c) => {
  const { companyId, loc } = await ctx(c, c.req.param("lid"));
  const body = await readJson(c);
  const { from, to } = readRange(c, body);
  const rows = (await rowsInRange(c.env, loc!, from, to)).filter((r) => statusOf(r) !== "published");
  if (!rows.length) return c.json({ published: 0 });
  const now = nowIso();
  await c.env.DB.batch(
    rows.map((r) =>
      r.is_deleted
        ? c.env.DB.prepare("DELETE FROM workspent_shifts WHERE id = ? AND company_id = ?").bind(r.id, companyId)
        : c.env.DB.prepare("UPDATE workspent_shifts SET published_json = ?, published_at = ? WHERE id = ? AND company_id = ?").bind(snapshot(r), now, r.id, companyId)
    )
  );
  return c.json({ published: rows.length });
});

/**
 * Copies the shifts of the week before into the week that starts on `weekStart` (a Sunday), as drafts.
 * It keeps each shift's local times. It skips a shift that would overlap, or whose person is off.
 */
scheduleRoutes.post("/companies/:id/locations/:lid/schedule/copy", async (c) => {
  const { companyId, access, loc } = await ctx(c, c.req.param("lid"));
  const l = loc!;
  const body = await readJson(c);
  const ws = body.weekStart;
  if (!isDate(ws) || weekday(ws) !== 0) throw new HttpError(400, "weekStart must be a Sunday, as a date like 2026-11-22.");
  const source = (await rowsInRange(c.env, l, addDays(ws, -7), addDays(ws, -1))).filter((r) => !r.is_deleted);
  const active = new Set(
    (await c.env.DB.prepare("SELECT id FROM workspent_people WHERE company_id = ? AND is_active = 1").bind(companyId).all<{ id: string }>()).results.map((r) => r.id)
  );
  const added: Array<{ startsAt: string; endsAt: string; personId: string | null }> = [];
  const stmts: D1PreparedStatement[] = [];
  let skipped = 0;
  const now = nowIso();
  for (const r of source) {
    if (r.person_id && !active.has(r.person_id)) {
      skipped++;
      continue;
    }
    const s = wallClock(Date.parse(r.starts_at), l.time_zone);
    const e = wallClock(Date.parse(r.ends_at), l.time_zone);
    const t = shiftTimes(addDays(s.date, 7), s.time, e.time, l.time_zone);
    if ("problem" in t) {
      skipped++;
      continue;
    }
    try {
      await checkOverlap(c.env, companyId, r.person_id, t, null, added.filter((a) => a.personId === r.person_id));
    } catch {
      skipped++;
      continue;
    }
    added.push({ ...t, personId: r.person_id });
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO workspent_shifts (id, company_id, location_id, person_id, starts_at, ends_at, break_minutes, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId(), companyId, l.id, r.person_id, t.startsAt, t.endsAt, r.break_minutes, r.note, access.userId, now, now)
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ copied: stmts.length, skipped });
});

/* My schedule --------------------------------------------------------- */

/** The published shifts of a person, from 12 hours ago to 3 weeks ahead. For My time. */
export async function upcomingShifts(env: Env, companyId: string, personId: string, nowMs: number): Promise<UpcomingShift[]> {
  const rows = await env.DB.prepare(
    `SELECT s.published_json, l.name AS location_name, l.time_zone FROM workspent_shifts s JOIN workspent_locations l ON l.id = s.location_id
     WHERE s.company_id = ? AND s.published_json IS NOT NULL AND json_extract(s.published_json, '$.personId') = ?
       AND json_extract(s.published_json, '$.endsAt') >= ? AND json_extract(s.published_json, '$.startsAt') <= ?`
  )
    .bind(companyId, personId, new Date(nowMs - 12 * 3_600_000).toISOString(), new Date(nowMs + 21 * 86_400_000).toISOString())
    .all<{ published_json: string; location_name: string; time_zone: string }>();
  return rows.results
    .map((r) => {
      const p = JSON.parse(r.published_json) as { startsAt: string; endsAt: string; breakMinutes: number; note: string };
      return { startsAt: p.startsAt, endsAt: p.endsAt, breakMinutes: p.breakMinutes, note: p.note, locationName: r.location_name, timeZone: r.time_zone };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

