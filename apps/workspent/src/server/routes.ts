import { Hono, type Context } from "hono";
import { HttpError, newId, nowIso, oneOf, randomToken, readJson, requireUser, sha256Hex, text, type AppEnv, type Env } from "@openact/core/server";
import {
  CSV_HEADER,
  DEVICE_KINDS,
  FLAG_LABELS,
  PERIOD_KINDS,
  PUNCH_KINDS,
  buildShifts,
  cleanLimits,
  clockState,
  csvRow,
  csvTime,
  hoursText,
  isDate,
  isTime,
  isTimeZone,
  localDate,
  periodOf,
  personSheet,
  pinProblem,
  readLimits,
  zonedToUtc,
  type ChangeInfo,
  type Me,
  type MyTime,
  type PersonDetail,
  type PersonInfo,
  type PunchKind,
  type TimesheetData
} from "../shared/rules.ts";
import {
  canManage,
  isLocked,
  locationInfos,
  locationPunches,
  locationRow,
  locationSheet,
  loadAccess,
  periodList,
  pickPeriod,
  approvedPeriods,
  pinHash,
  randomPin,
  recentPersonPunches,
  requireClock,
  requireManage,
  requireSetup,
  shiftsOf,
  toDevice,
  toLocation,
  toPunchInfo,
  type Access,
  type DeviceRow,
  type LocationRow
} from "./store.ts";
import { upcomingShifts } from "./schedule.ts";
import { companyKinds } from "./projects.ts";

/*
 * WorkSpent routes for signed-in people, all under /api/apps/workspent/companies/:id.
 * Each route loads the person's access first: setup, manage (all locations or some) and clock.
 * Managers fix hours with a reason. The fix keeps the original, and the person can confirm or question it.
 */

export const companyRoutes = new Hono<AppEnv>();

async function ctx(c: Context<AppEnv>): Promise<{ companyId: string; access: Access }> {
  const user = requireUser(c);
  const companyId = c.req.param("id")!;
  return { companyId, access: await loadAccess(c.env, companyId, user.id) };
}

const UUIDISH = /^[0-9a-f-]{36}$/;
const idParam = (c: Context<AppEnv>, name: string) => {
  const v = c.req.param(name) ?? "";
  if (!UUIDISH.test(v)) throw new HttpError(404, "This item does not exist.");
  return v;
};

function reasonOf(body: Record<string, unknown>): string {
  return text(body.reason, "Why", { max: 300, required: true });
}

/** The person linked to this account in the company, if any. */
async function personOfUser(env: Env, companyId: string, userId: string) {
  return env.DB.prepare("SELECT id, name FROM workspent_people WHERE company_id = ? AND user_id = ? AND is_active = 1")
    .bind(companyId, userId)
    .first<{ id: string; name: string }>();
}

async function personRow(env: Env, companyId: string, personId: string) {
  const p = await env.DB.prepare("SELECT id, name, user_id, is_active FROM workspent_people WHERE id = ? AND company_id = ?")
    .bind(personId, companyId)
    .first<{ id: string; name: string; user_id: string | null; is_active: number }>();
  if (!p) throw new HttpError(404, "This person does not exist. They may belong to another company.");
  return p;
}

function notSelf(a: Access, person: { user_id: string | null }) {
  if (person.user_id && person.user_id === a.userId)
    throw new HttpError(403, "You cannot change your own hours. Ask another manager, or a company owner or admin.", "own_hours");
}

/* Me ---------------------------------------------------------------- */

companyRoutes.get("/companies/:id/me", async (c) => {
  const { companyId, access } = await ctx(c);
  const [person, k] = await Promise.all([personOfUser(c.env, companyId, access.userId), companyKinds(c.env, companyId)]);
  const me: Me = {
    canSetup: access.setup,
    canManageAll: access.manageAll,
    managedLocationIds: [...access.managed],
    personId: person?.id ?? null,
    canClock: access.clock,
    canTrack: access.track,
    projects: k.kinds.projects,
    shifts: k.kinds.shifts
  };
  return c.json(me);
});

/** Company members, to link a person to an account or to make a location manager. */
companyRoutes.get("/companies/:id/members", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const rows = await c.env.DB.prepare(
    `SELECT u.id AS userId, u.name, u.email, m.role FROM company_members m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = ? ORDER BY u.name COLLATE NOCASE`
  )
    .bind(companyId)
    .all<{ userId: string; name: string; email: string; role: string }>();
  return c.json({ members: rows.results });
});

/* Locations --------------------------------------------------------- */

companyRoutes.get("/companies/:id/locations", async (c) => {
  const { companyId, access } = await ctx(c);
  if (!access.setup && !access.manageAll && !access.managed.size)
    throw new HttpError(403, "You do not manage a location. Ask a company owner or admin.", "no_permission");
  const only = access.setup || access.manageAll ? undefined : [...access.managed];
  return c.json({ locations: await locationInfos(c.env, companyId, access, only) });
});

function readLocationFields(body: Record<string, unknown>, creating: boolean) {
  const out: Record<string, unknown> = {};
  if (creating || body.name !== undefined) out.name = text(body.name, "Name", { max: 100, required: true });
  if (creating || body.timeZone !== undefined) {
    if (!isTimeZone(body.timeZone)) throw new HttpError(400, "Pick a time zone from the list, such as America/Los_Angeles.");
    out.time_zone = body.timeZone;
  }
  if (creating || body.periodKind !== undefined) out.period_kind = oneOf(body.periodKind ?? "biweekly", "Pay period", PERIOD_KINDS);
  if (creating || body.periodStartDate !== undefined) {
    if (!isDate(body.periodStartDate)) throw new HttpError(400, "The first day of a pay period must be a date like 2026-11-16.");
    out.period_start_date = body.periodStartDate;
  }
  if (body.limits !== undefined) {
    const r = cleanLimits(body.limits);
    if ("problem" in r) throw new HttpError(400, r.problem);
    out.flags_json = JSON.stringify(r.limits);
  }
  if (!creating && body.isArchived !== undefined) {
    if (typeof body.isArchived !== "boolean") throw new HttpError(400, "isArchived must be true or false.");
    out.is_archived = body.isArchived ? 1 : 0;
  }
  return out;
}

companyRoutes.post("/companies/:id/locations", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const body = await readJson(c);
  const f = readLocationFields(body, true);
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO workspent_locations (id, company_id, name, time_zone, clock_rule, period_kind, period_start_date, flags_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'on_site', ?, ?, ?, ?, ?)`
  )
    .bind(id, companyId, f.name, f.time_zone, f.period_kind, f.period_start_date, (f.flags_json as string) ?? "{}", now, now)
    .run();
  const [info] = await locationInfos(c.env, companyId, access, [id]);
  return c.json({ location: info }, 201);
});

companyRoutes.patch("/companies/:id/locations/:lid", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const lid = idParam(c, "lid");
  await locationRow(c.env, companyId, lid);
  const f = readLocationFields(await readJson(c), false);
  const cols = Object.keys(f);
  if (cols.length) {
    await c.env.DB.prepare(`UPDATE workspent_locations SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND company_id = ?`)
      .bind(...cols.map((k) => f[k]), nowIso(), lid, companyId)
      .run();
  }
  const [info] = await locationInfos(c.env, companyId, access, [lid]);
  return c.json({ location: info });
});

/** Sets the location managers. Only owners, admins and members can manage a location. */
companyRoutes.put("/companies/:id/locations/:lid/managers", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const lid = idParam(c, "lid");
  await locationRow(c.env, companyId, lid);
  const body = await readJson(c);
  if (!Array.isArray(body.userIds) || body.userIds.length > 100 || !body.userIds.every((u) => typeof u === "string"))
    throw new HttpError(400, "Send userIds as a list of people in the company.");
  const ids = [...new Set(body.userIds as string[])];
  if (ids.length) {
    const found = await c.env.DB.prepare(
      `SELECT user_id FROM company_members WHERE company_id = ? AND role != 'guest' AND user_id IN (${ids.map(() => "?").join(",")})`
    )
      .bind(companyId, ...ids)
      .all<{ user_id: string }>();
    if (found.results.length !== ids.length) throw new HttpError(404, "A location manager must be an owner, admin or member of this company.");
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM workspent_location_managers WHERE location_id = ? AND company_id = ?").bind(lid, companyId),
    ...ids.map((u) =>
      c.env.DB.prepare("INSERT INTO workspent_location_managers (location_id, user_id, company_id, created_at) VALUES (?, ?, ?, ?)").bind(lid, u, companyId, now)
    )
  ]);
  return c.json({ managerIds: ids });
});

/* Devices ----------------------------------------------------------- */

companyRoutes.get("/companies/:id/locations/:lid/devices", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  await locationRow(c.env, companyId, lid);
  if (!access.setup) requireManage(access, lid);
  const rows = await c.env.DB.prepare("SELECT * FROM workspent_devices WHERE location_id = ? AND company_id = ? ORDER BY is_active DESC, name COLLATE NOCASE")
    .bind(lid, companyId)
    .all<DeviceRow>();
  const now = Date.now();
  return c.json({ devices: rows.results.map((d) => toDevice(d, now)) });
});

/**
 * Sets up a time clock device. The answer holds the device key once. The web app keeps it in the browser of this device.
 * The server keeps only its hash.
 */
companyRoutes.post("/companies/:id/locations/:lid/devices", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  if (loc.is_archived) throw new HttpError(400, "This location is archived. Set up the device for another location.");
  const body = await readJson(c);
  const name = text(body.name, "Device name", { max: 60, required: true });
  const kind = oneOf(body.kind ?? "tablet", "Kind", DEVICE_KINDS);
  const id = newId();
  const secret = randomToken(32);
  await c.env.DB.prepare(
    `INSERT INTO workspent_devices (id, company_id, location_id, name, kind, key_hash, is_active, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(id, companyId, lid, name, kind, await sha256Hex(secret), access.userId, nowIso())
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM workspent_devices WHERE id = ?").bind(id).first<DeviceRow>();
  return c.json({ device: toDevice(row!, Date.now()), key: `${id}.${secret}`, location: { id: loc.id, name: loc.name } }, 201);
});

async function deviceRow(env: Env, companyId: string, did: string): Promise<DeviceRow> {
  const d = await env.DB.prepare("SELECT * FROM workspent_devices WHERE id = ? AND company_id = ?").bind(did, companyId).first<DeviceRow>();
  if (!d) throw new HttpError(404, "This device does not exist. It may belong to another company.");
  return d;
}

/** Switch off: deletes the device key. The device stops working at once. Its clock-ins stay. */
companyRoutes.post("/companies/:id/devices/:did/off", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const d = await deviceRow(c.env, companyId, idParam(c, "did"));
  await c.env.DB.prepare("UPDATE workspent_devices SET is_active = 0, key_hash = '' WHERE id = ? AND company_id = ?").bind(d.id, companyId).run();
  return c.json({ ok: true });
});

/** Unlocks the PIN pad of a device after too many wrong PINs. */
companyRoutes.post("/companies/:id/devices/:did/unlock", async (c) => {
  const { companyId, access } = await ctx(c);
  const d = await deviceRow(c.env, companyId, idParam(c, "did"));
  if (!access.setup) requireManage(access, d.location_id);
  await c.env.DB.prepare("UPDATE workspent_devices SET wrong_pin_count = 0, locked_until_ms = NULL WHERE id = ? AND company_id = ?").bind(d.id, companyId).run();
  return c.json({ ok: true });
});

/* People ------------------------------------------------------------ */

async function peopleInfos(env: Env, companyId: string, onlyId?: string): Promise<PersonInfo[]> {
  const [people, links] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.name, p.user_id, u.email, p.pin_hash IS NOT NULL AS has_pin, p.is_active FROM workspent_people p
       LEFT JOIN users u ON u.id = p.user_id WHERE p.company_id = ?${onlyId ? " AND p.id = ?" : ""} ORDER BY p.is_active DESC, p.name COLLATE NOCASE`
    ).bind(...(onlyId ? [companyId, onlyId] : [companyId])),
    env.DB.prepare("SELECT person_id, location_id FROM workspent_person_locations WHERE company_id = ?").bind(companyId)
  ]);
  const ls = links!.results as Array<{ person_id: string; location_id: string }>;
  return (people!.results as Array<{ id: string; name: string; user_id: string | null; email: string | null; has_pin: number; is_active: number }>).map((p) => ({
    id: p.id,
    name: p.name,
    userId: p.user_id,
    email: p.email,
    hasPin: p.has_pin === 1,
    isActive: p.is_active === 1,
    locationIds: ls.filter((l) => l.person_id === p.id).map((l) => l.location_id)
  }));
}

companyRoutes.get("/companies/:id/people", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  return c.json({ people: await peopleInfos(c.env, companyId) });
});

async function checkLocations(env: Env, companyId: string, v: unknown): Promise<string[]> {
  if (!Array.isArray(v) || v.length > 200 || !v.every((x) => typeof x === "string")) throw new HttpError(400, "Send locationIds as a list of locations.");
  const ids = [...new Set(v as string[])];
  if (!ids.length) return ids;
  const found = await env.DB.prepare(`SELECT id FROM workspent_locations WHERE company_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(companyId, ...ids)
    .all<{ id: string }>();
  if (found.results.length !== ids.length) throw new HttpError(404, "A location in the list does not exist. It may belong to another company.");
  return ids;
}

async function checkUser(env: Env, companyId: string, v: unknown, personId: string | null): Promise<string | null> {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") throw new HttpError(400, "userId must be the id of a person in the company.");
  const m = await env.DB.prepare("SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ?").bind(companyId, v).first();
  if (!m) throw new HttpError(404, "That account is not in this company.");
  const taken = await env.DB.prepare("SELECT id FROM workspent_people WHERE company_id = ? AND user_id = ? AND id != ?")
    .bind(companyId, v, personId ?? "")
    .first();
  if (taken) throw new HttpError(409, "That account is already linked to another person in WorkSpent.");
  return v;
}

/** True when another active person at one of these locations has this PIN hash. */
async function pinTaken(env: Env, companyId: string, hash: string, locationIds: string[], personId: string | null): Promise<boolean> {
  if (!locationIds.length) return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM workspent_people p JOIN workspent_person_locations pl ON pl.person_id = p.id
     WHERE p.company_id = ? AND p.pin_hash = ? AND p.is_active = 1 AND p.id != ? AND pl.location_id IN (${locationIds.map(() => "?").join(",")}) LIMIT 1`
  )
    .bind(companyId, hash, personId ?? "", ...locationIds)
    .first();
  return !!row;
}

/** A PIN for a person: the one typed, or a new random one. Checks that it is unique at the person's locations. */
async function choosePin(c: Context<AppEnv>, companyId: string, wanted: unknown, locationIds: string[], personId: string | null) {
  if (wanted !== undefined && wanted !== null && wanted !== "") {
    const problem = pinProblem(wanted);
    if (problem) throw new HttpError(400, problem);
    const hash = await pinHash(c.env, c.req.url, companyId, wanted as string);
    if (await pinTaken(c.env, companyId, hash, locationIds, personId))
      throw new HttpError(409, "Another person at one of these locations has this PIN. Pick another PIN.");
    return { pin: wanted as string, hash };
  }
  for (let i = 0; i < 30; i++) {
    const pin = randomPin(i < 20 ? 4 : 6);
    const hash = await pinHash(c.env, c.req.url, companyId, pin);
    if (!(await pinTaken(c.env, companyId, hash, locationIds, personId))) return { pin, hash };
  }
  throw new HttpError(500, "WorkSpent could not make a free PIN. Try again.");
}

companyRoutes.post("/companies/:id/people", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const body = await readJson(c);
  const name = text(body.name, "Name", { max: 100, required: true });
  const locationIds = await checkLocations(c.env, companyId, body.locationIds ?? []);
  const userId = await checkUser(c.env, companyId, body.userId, null);
  const { pin, hash } = await choosePin(c, companyId, body.pin, locationIds, null);
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO workspent_people (id, company_id, name, user_id, pin_hash, pin_set_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(id, companyId, name, userId, hash, now, now, now),
    ...locationIds.map((l) =>
      c.env.DB.prepare("INSERT INTO workspent_person_locations (person_id, location_id, company_id) VALUES (?, ?, ?)").bind(id, l, companyId)
    )
  ]);
  const [person] = await peopleInfos(c.env, companyId, id);
  return c.json({ person, pin }, 201);
});

companyRoutes.patch("/companies/:id/people/:pid", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetup(access);
  const pid = idParam(c, "pid");
  await personRow(c.env, companyId, pid);
  const body = await readJson(c);
  const stmts: D1PreparedStatement[] = [];
  const now = nowIso();
  if (body.name !== undefined)
    stmts.push(c.env.DB.prepare("UPDATE workspent_people SET name = ?, updated_at = ? WHERE id = ? AND company_id = ?").bind(text(body.name, "Name", { max: 100, required: true }), now, pid, companyId));
  if (body.userId !== undefined) {
    const userId = await checkUser(c.env, companyId, body.userId, pid);
    stmts.push(c.env.DB.prepare("UPDATE workspent_people SET user_id = ?, updated_at = ? WHERE id = ? AND company_id = ?").bind(userId, now, pid, companyId));
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false.");
    stmts.push(c.env.DB.prepare("UPDATE workspent_people SET is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?").bind(body.isActive ? 1 : 0, now, pid, companyId));
  }
  if (body.locationIds !== undefined) {
    const locationIds = await checkLocations(c.env, companyId, body.locationIds);
    const cur = await c.env.DB.prepare("SELECT pin_hash FROM workspent_people WHERE id = ?").bind(pid).first<{ pin_hash: string | null }>();
    if (cur?.pin_hash && (await pinTaken(c.env, companyId, cur.pin_hash, locationIds, pid)))
      throw new HttpError(409, "Another person at one of these locations has the same PIN. Give this person a new PIN first.");
    stmts.push(c.env.DB.prepare("DELETE FROM workspent_person_locations WHERE person_id = ? AND company_id = ?").bind(pid, companyId));
    for (const l of locationIds)
      stmts.push(c.env.DB.prepare("INSERT INTO workspent_person_locations (person_id, location_id, company_id) VALUES (?, ?, ?)").bind(pid, l, companyId));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  const [person] = await peopleInfos(c.env, companyId, pid);
  return c.json({ person });
});

/** A new PIN. Setup can do it for anyone. A manager can do it for a person at a location they manage. */
companyRoutes.post("/companies/:id/people/:pid/pin", async (c) => {
  const { companyId, access } = await ctx(c);
  const pid = idParam(c, "pid");
  await personRow(c.env, companyId, pid);
  const locs = (
    await c.env.DB.prepare("SELECT location_id FROM workspent_person_locations WHERE person_id = ? AND company_id = ?").bind(pid, companyId).all<{ location_id: string }>()
  ).results.map((r) => r.location_id);
  if (!access.setup && !locs.some((l) => canManage(access, l)))
    throw new HttpError(403, "You do not manage a location of this person. Ask a company owner or admin.", "no_permission");
  const body = await readJson(c);
  const { pin, hash } = await choosePin(c, companyId, body.pin, locs, pid);
  await c.env.DB.prepare("UPDATE workspent_people SET pin_hash = ?, pin_set_at = ?, updated_at = ? WHERE id = ? AND company_id = ?")
    .bind(hash, nowIso(), nowIso(), pid, companyId)
    .run();
  return c.json({ pin });
});

/* Timesheets -------------------------------------------------------- */

companyRoutes.get("/companies/:id/locations/:lid/timesheet", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  const now = Date.now();
  const period = pickPeriod(loc, c.req.query("start") || undefined, now);
  const [sheet, saved, devices] = await Promise.all([
    locationSheet(c.env, loc, period, now),
    approvedPeriods(c.env, companyId, lid),
    c.env.DB.prepare("SELECT * FROM workspent_devices WHERE location_id = ? AND company_id = ? AND is_active = 1").bind(lid, companyId).all<DeviceRow>()
  ]);
  const savedRow = saved.find((s) => s.start_date === period.start);
  const approved = savedRow?.status === "approved";
  const approver = approved && savedRow?.approved_by ? await c.env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(savedRow.approved_by).first<{ name: string }>() : null;
  const onClock: TimesheetData["onClock"] = [];
  for (const p of sheet.people) {
    const shifts = sheet.shifts.get(p.id) ?? [];
    const s = clockState(shifts);
    if (s.state === "out") continue;
    const last = shifts[shifts.length - 1]!;
    const firstPunch = sheet.rows.find((r) => r.id === last.punchIds[0]);
    onClock.push({ personId: p.id, name: p.name, state: s.state, since: s.since, source: firstPunch?.device_name ?? firstPunch?.source ?? "" });
  }
  const data: TimesheetData = {
    location: toLocation(loc, true),
    period,
    periods: periodList(loc, saved, now),
    status: approved ? "approved" : "open",
    ended: period.end < localDate(now, loc.time_zone),
    approvedBy: approver?.name ?? null,
    approvedAt: approved ? (savedRow?.approved_at ?? null) : null,
    canReopen: access.role === "owner" || access.role === "admin",
    rows: sheet.people.map((p) => ({ person: { id: p.id, name: p.name, isSelf: p.user_id === access.userId }, sheet: sheet.sheets.get(p.id)! })),
    onClock,
    devices: { online: devices.results.map((d) => toDevice(d, now)).filter((d) => d.online).length, total: devices.results.length }
  };
  return c.json(data);
});

async function changesFor(env: Env, companyId: string, where: string, args: unknown[]): Promise<ChangeInfo[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.punch_id, c.action, c.old_json, c.new_json, c.reason, u.name AS changed_by, c.changed_at, c.response, c.response_note
     FROM workspent_changes c LEFT JOIN users u ON u.id = c.changed_by WHERE c.company_id = ? AND ${where} ORDER BY c.changed_at`
  )
    .bind(companyId, ...args)
    .all<{
      id: string;
      punch_id: string;
      action: ChangeInfo["action"];
      old_json: string | null;
      new_json: string | null;
      reason: string;
      changed_by: string | null;
      changed_at: string;
      response: ChangeInfo["response"];
      response_note: string | null;
    }>();
  return rows.results.map((r) => {
    const o = r.old_json ? (JSON.parse(r.old_json) as { at: string; kind: PunchKind }) : null;
    const n = r.new_json ? (JSON.parse(r.new_json) as { at: string; kind: PunchKind }) : null;
    return {
      id: r.id,
      punchId: r.punch_id,
      action: r.action,
      oldAt: o?.at ?? null,
      newAt: n?.at ?? null,
      kind: (n ?? o)!.kind,
      reason: r.reason,
      changedBy: r.changed_by,
      changedAt: r.changed_at,
      response: r.response,
      responseNote: r.response_note
    };
  });
}

/** One person's clock-ins at a location for a period, with every fix. */
companyRoutes.get("/companies/:id/locations/:lid/people/:pid", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  const person = await personRow(c.env, companyId, idParam(c, "pid"));
  const now = Date.now();
  const period = pickPeriod(loc, c.req.query("start") || undefined, now);
  const rows = await locationPunches(c.env, companyId, lid, period, person.id);
  const shifts = shiftsOf(rows, loc.time_zone, loc.flags_json, now).get(person.id) ?? [];
  const sheet = personSheet(person.id, shifts, period, readLimits(loc.flags_json));
  const saved = await approvedPeriods(c.env, companyId, lid);
  const inside = rows.filter((r) => {
    const d = localDate(Date.parse(r.punched_at), loc.time_zone);
    return d >= period.start && d <= period.end;
  });
  const recent = await recentPersonPunches(c.env, companyId, person.id, now);
  const detail: PersonDetail = {
    person: { id: person.id, name: person.name, isSelf: person.user_id === access.userId },
    location: toLocation(loc, true),
    period,
    status: saved.some((s) => s.start_date === period.start && s.status === "approved") ? "approved" : "open",
    punches: inside.map(toPunchInfo),
    changes: await changesFor(c.env, companyId, "c.person_id = ? AND c.location_id = ?", [person.id, lid]),
    sheet,
    state: clockState(buildShifts(recent, loc.time_zone, readLimits(loc.flags_json), now))
  };
  return c.json(detail);
});

/* Manager fixes ----------------------------------------------------- */

/** A time from a local date and time at the location, or now. Refuses a time in the future. */
function readTime(loc: LocationRow, date: unknown, time: unknown, now: number, field = "The time"): string {
  if (date === undefined && time === undefined) return new Date(now).toISOString();
  if (!isDate(date) || !isTime(time)) throw new HttpError(400, `${field} needs a date like 2026-11-18 and a time like 14:30.`);
  const ms = zonedToUtc(date, time, loc.time_zone);
  if (ms > now + 60_000) throw new HttpError(400, `${field} is in the future. Pick a time that has passed.`);
  return new Date(ms).toISOString();
}

function checkOpen(saved: Awaited<ReturnType<typeof approvedPeriods>>, loc: LocationRow, iso: string) {
  if (isLocked(saved, localDate(Date.parse(iso), loc.time_zone)))
    throw new HttpError(409, "This pay period is approved, so its hours are locked. A company owner or admin can reopen it.", "period_locked");
}

const punchJson = (kind: PunchKind, at: string) => JSON.stringify({ kind, at });

function insertPunch(env: Env, a: { id: string; companyId: string; personId: string; locationId: string; kind: PunchKind; at: string; userId: string }) {
  return env.DB.prepare(
    `INSERT INTO workspent_punches (id, company_id, person_id, location_id, kind, punched_at, source, is_late_sync, created_by, received_at)
     VALUES (?, ?, ?, ?, ?, ?, 'manager', 0, ?, ?)`
  ).bind(a.id, a.companyId, a.personId, a.locationId, a.kind, a.at, a.userId, nowIso());
}

function insertChange(
  env: Env,
  a: { companyId: string; punchId: string; personId: string; locationId: string; action: "add" | "change" | "delete"; old: string | null; next: string | null; reason: string; userId: string }
) {
  return env.DB.prepare(
    `INSERT INTO workspent_changes (id, company_id, punch_id, person_id, location_id, action, old_json, new_json, reason, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId(), a.companyId, a.punchId, a.personId, a.locationId, a.action, a.old, a.next, a.reason, a.userId, nowIso());
}

/** Adds one clock event: a missed clock-in or clock-out, a break, or a clock-in or clock-out now (no date and time). */
companyRoutes.post("/companies/:id/locations/:lid/punches", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  const body = await readJson(c);
  const person = await personRow(c.env, companyId, typeof body.personId === "string" ? body.personId : "");
  notSelf(access, person);
  const kind = oneOf(body.kind, "kind", PUNCH_KINDS);
  const reason = reasonOf(body);
  const now = Date.now();
  const at = readTime(loc, body.date, body.time, now);
  checkOpen(await approvedPeriods(c.env, companyId, lid), loc, at);
  const id = newId();
  await c.env.DB.batch([
    insertPunch(c.env, { id, companyId, personId: person.id, locationId: lid, kind, at, userId: access.userId }),
    insertChange(c.env, { companyId, punchId: id, personId: person.id, locationId: lid, action: "add", old: null, next: punchJson(kind, at), reason, userId: access.userId })
  ]);
  return c.json({ id, kind, at }, 201);
});

/** Adds a whole shift: a clock-in, a clock-out and an optional meal break. A clock-out before the clock-in is on the next day. */
companyRoutes.post("/companies/:id/locations/:lid/shifts", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  const body = await readJson(c);
  const person = await personRow(c.env, companyId, typeof body.personId === "string" ? body.personId : "");
  notSelf(access, person);
  const reason = reasonOf(body);
  if (!isDate(body.date)) throw new HttpError(400, "The shift needs a date like 2026-11-18.");
  const date = body.date;
  const now = Date.now();
  const inAt = readTime(loc, date, body.inTime, now, "The clock-in");
  const later = (t: unknown, field: string) => {
    let iso = readTime(loc, date, t, now + 2 * 86_400_000, field);
    if (iso <= inAt) iso = readTime(loc, nextDay(date), t, now + 2 * 86_400_000, field);
    if (Date.parse(iso) > now + 60_000) throw new HttpError(400, `${field} is in the future. Pick a time that has passed.`);
    return iso;
  };
  const outAt = later(body.outTime, "The clock-out");
  const events: Array<{ kind: PunchKind; at: string }> = [{ kind: "in", at: inAt }];
  if (body.breakStart !== undefined || body.breakEnd !== undefined) {
    const bs = later(body.breakStart, "The break start");
    const be = later(body.breakEnd, "The break end");
    if (!(bs < be && be <= outAt)) throw new HttpError(400, "The meal break must start after the clock-in and end before the clock-out.");
    events.push({ kind: "break_start", at: bs }, { kind: "break_end", at: be });
  }
  events.push({ kind: "out", at: outAt });
  const saved = await approvedPeriods(c.env, companyId, lid);
  for (const e of events) checkOpen(saved, loc, e.at);
  const stmts: D1PreparedStatement[] = [];
  for (const e of events) {
    const id = newId();
    stmts.push(insertPunch(c.env, { id, companyId, personId: person.id, locationId: lid, kind: e.kind, at: e.at, userId: access.userId }));
    stmts.push(
      insertChange(c.env, { companyId, punchId: id, personId: person.id, locationId: lid, action: "add", old: null, next: punchJson(e.kind, e.at), reason, userId: access.userId })
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ added: events.length }, 201);
});

const nextDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);

async function punchFor(c: Context<AppEnv>, companyId: string, access: Access) {
  const pid = idParam(c, "pid");
  const p = await c.env.DB.prepare("SELECT id, person_id, location_id, kind, punched_at, is_deleted FROM workspent_punches WHERE id = ? AND company_id = ?")
    .bind(pid, companyId)
    .first<{ id: string; person_id: string; location_id: string; kind: PunchKind; punched_at: string; is_deleted: number }>();
  if (!p) throw new HttpError(404, "This clock-in does not exist. It may belong to another company.");
  requireManage(access, p.location_id);
  const person = await personRow(c.env, companyId, p.person_id);
  notSelf(access, person);
  const loc = await locationRow(c.env, companyId, p.location_id);
  if (p.is_deleted) throw new HttpError(409, "This clock-in is deleted. Add a new one instead.");
  return { p, loc };
}

/** Changes the time of a clock event. The old time stays in the audit trail. */
companyRoutes.patch("/companies/:id/punches/:pid", async (c) => {
  const { companyId, access } = await ctx(c);
  const { p, loc } = await punchFor(c, companyId, access);
  const body = await readJson(c);
  const reason = reasonOf(body);
  const at = readTime(loc, body.date, body.time, Date.now());
  const saved = await approvedPeriods(c.env, companyId, loc.id);
  checkOpen(saved, loc, p.punched_at);
  checkOpen(saved, loc, at);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE workspent_punches SET punched_at = ? WHERE id = ? AND company_id = ?").bind(at, p.id, companyId),
    insertChange(c.env, {
      companyId,
      punchId: p.id,
      personId: p.person_id,
      locationId: loc.id,
      action: "change",
      old: punchJson(p.kind, p.punched_at),
      next: punchJson(p.kind, at),
      reason,
      userId: access.userId
    })
  ]);
  return c.json({ id: p.id, at });
});

/** Deletes a wrong clock event. It stays, crossed out, with who deleted it and why. */
companyRoutes.delete("/companies/:id/punches/:pid", async (c) => {
  const { companyId, access } = await ctx(c);
  const { p, loc } = await punchFor(c, companyId, access);
  const reason = reasonOf(await readJson(c));
  checkOpen(await approvedPeriods(c.env, companyId, loc.id), loc, p.punched_at);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE workspent_punches SET is_deleted = 1 WHERE id = ? AND company_id = ?").bind(p.id, companyId),
    insertChange(c.env, {
      companyId,
      punchId: p.id,
      personId: p.person_id,
      locationId: loc.id,
      action: "delete",
      old: punchJson(p.kind, p.punched_at),
      next: null,
      reason,
      userId: access.userId
    })
  ]);
  return c.json({ ok: true });
});

/* Approval and export ----------------------------------------------- */

companyRoutes.post("/companies/:id/locations/:lid/periods/:start/approve", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  const now = Date.now();
  const period = pickPeriod(loc, c.req.param("start"), now);
  if (period.end >= localDate(now, loc.time_zone)) throw new HttpError(409, "This pay period has not ended yet. Approve it after its last day.");
  const sheet = await locationSheet(c.env, loc, period, now);
  const missed = [...sheet.sheets.values()].reduce((n, s) => n + s.shifts.filter((x) => x.flags.includes("missed_in") || x.flags.includes("missed_out")).length, 0);
  if (missed) throw new HttpError(409, `Fix ${missed} missed clock-in${missed === 1 ? "" : "s"} or clock-out${missed === 1 ? "" : "s"} first. Then approve the period.`);
  const self = sheet.people.find((p) => p.user_id === access.userId && (sheet.sheets.get(p.id)?.shifts.length ?? 0) > 0);
  if (self) throw new HttpError(403, "Your own hours are in this period. Ask another manager, or a company owner or admin, to approve it.", "own_hours");
  const t = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO workspent_periods (id, company_id, location_id, start_date, end_date, status, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)
     ON CONFLICT (location_id, start_date) DO UPDATE SET status = 'approved', end_date = excluded.end_date, approved_by = excluded.approved_by, approved_at = excluded.approved_at`
  )
    .bind(newId(), companyId, lid, period.start, period.end, access.userId, t)
    .run();
  return c.json({ status: "approved", approvedAt: t });
});

companyRoutes.post("/companies/:id/locations/:lid/periods/:start/reopen", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  if (access.role !== "owner" && access.role !== "admin")
    throw new HttpError(403, "Only a company owner or admin can reopen an approved pay period.", "no_permission");
  const period = pickPeriod(loc, c.req.param("start"), Date.now());
  const r = await c.env.DB.prepare(
    "UPDATE workspent_periods SET status = 'open', reopened_by = ?, reopened_at = ? WHERE location_id = ? AND company_id = ? AND start_date = ? AND status = 'approved'"
  )
    .bind(access.userId, nowIso(), lid, companyId, period.start)
    .run();
  if (!r.meta.changes) throw new HttpError(409, "This pay period is not approved.");
  return c.json({ status: "open" });
});

/** The CSV for payroll: one row per shift. Only an approved period exports. */
companyRoutes.get("/companies/:id/locations/:lid/periods/:start/export", async (c) => {
  const { companyId, access } = await ctx(c);
  const lid = idParam(c, "lid");
  const loc = await locationRow(c.env, companyId, lid);
  requireManage(access, lid);
  const now = Date.now();
  const period = pickPeriod(loc, c.req.param("start"), now);
  const saved = await approvedPeriods(c.env, companyId, lid);
  if (!saved.some((s) => s.start_date === period.start && s.status === "approved"))
    throw new HttpError(409, "Approve this pay period first. Then export it.", "not_approved");
  const sheet = await locationSheet(c.env, loc, period, now);
  const changes = await c.env.DB.prepare("SELECT punch_id, reason FROM workspent_changes WHERE company_id = ? AND location_id = ?")
    .bind(companyId, lid)
    .all<{ punch_id: string; reason: string }>();
  const lines = [csvRow(CSV_HEADER)];
  for (const p of sheet.people) {
    for (const s of sheet.sheets.get(p.id)?.shifts ?? []) {
      const fixes = changes.results.filter((x) => s.punchIds.includes(x.punch_id));
      lines.push(
        csvRow([
          p.name,
          loc.name,
          s.date,
          csvTime(s.inAt, loc.time_zone),
          csvTime(s.outAt, loc.time_zone),
          s.breakMinutes,
          s.minutes,
          hoursText(s.minutes),
          s.flags.map((f) => FLAG_LABELS[f]).join("; "),
          fixes.length ? `${fixes.length} fix${fixes.length === 1 ? "" : "es"}: ${fixes.map((f) => f.reason).join("; ")}` : ""
        ])
      );
    }
  }
  const slug = loc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "location";
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="workspent-${slug}-${period.start}-to-${period.end}.csv"`
    }
  });
});

/* My time ----------------------------------------------------------- */

companyRoutes.get("/companies/:id/my-time", async (c) => {
  const { companyId, access } = await ctx(c);
  requireClock(access);
  const person = await personOfUser(c.env, companyId, access.userId);
  const out: MyTime = { person: person ? { id: person.id, name: person.name } : null, upcoming: [], locations: [], changes: [] };
  if (!person) return c.json(out);
  const now = Date.now();
  out.upcoming = await upcomingShifts(c.env, companyId, person.id, now);
  const locIds = (
    await c.env.DB.prepare(
      `SELECT location_id FROM workspent_person_locations WHERE person_id = ? AND company_id = ?
       UNION SELECT DISTINCT location_id FROM workspent_punches WHERE person_id = ? AND company_id = ? AND punched_at >= ?`
    )
      .bind(person.id, companyId, person.id, companyId, new Date(now - 45 * 86_400_000).toISOString())
      .all<{ location_id: string }>()
  ).results.map((r) => r.location_id);
  for (const lid of locIds) {
    const loc = await locationRow(c.env, companyId, lid);
    const period = periodOf(localDate(now, loc.time_zone), loc.period_kind, loc.period_start_date);
    const rows = await locationPunches(c.env, companyId, lid, period, person.id);
    const shifts = shiftsOf(rows, loc.time_zone, loc.flags_json, now).get(person.id) ?? [];
    const sheet = personSheet(person.id, shifts, period, readLimits(loc.flags_json));
    if (loc.is_archived && !sheet.shifts.length) continue;
    out.locations.push({
      location: { id: loc.id, name: loc.name, timeZone: loc.time_zone },
      period,
      sheet,
      punches: rows.filter((r) => {
        const d = localDate(Date.parse(r.punched_at), loc.time_zone);
        return d >= period.start && d <= period.end;
      }).map(toPunchInfo)
    });
  }
  const changes = await changesFor(c.env, companyId, "c.person_id = ? AND c.changed_at >= ?", [person.id, new Date(now - 45 * 86_400_000).toISOString()]);
  const locs = await c.env.DB.prepare("SELECT id, name, time_zone FROM workspent_locations WHERE company_id = ?").bind(companyId).all<{ id: string; name: string; time_zone: string }>();
  const locOfPunch = await c.env.DB.prepare("SELECT id, location_id FROM workspent_punches WHERE person_id = ? AND company_id = ?")
    .bind(person.id, companyId)
    .all<{ id: string; location_id: string }>();
  out.changes = changes.map((ch) => {
    const l = locs.results.find((x) => x.id === locOfPunch.results.find((p) => p.id === ch.punchId)?.location_id);
    return { ...ch, locationName: l?.name ?? "", timeZone: l?.time_zone ?? "UTC" };
  });
  return c.json(out);
});

/** The person confirms a manager fix, or questions it. A questioned fix is flagged on the timesheet. */
companyRoutes.post("/companies/:id/changes/:cid/respond", async (c) => {
  const { companyId, access } = await ctx(c);
  requireClock(access);
  const cid = idParam(c, "cid");
  const person = await personOfUser(c.env, companyId, access.userId);
  const ch = await c.env.DB.prepare("SELECT id, person_id FROM workspent_changes WHERE id = ? AND company_id = ?").bind(cid, companyId).first<{ id: string; person_id: string }>();
  if (!ch || !person || ch.person_id !== person.id) throw new HttpError(404, "This change does not exist, or it is not about your hours.");
  const body = await readJson(c);
  const response = oneOf(body.response, "response", ["confirmed", "questioned"] as const);
  const note = text(body.note, "Note", { max: 300 });
  await c.env.DB.prepare("UPDATE workspent_changes SET response = ?, response_note = ?, responded_at = ? WHERE id = ? AND company_id = ?")
    .bind(response, note || null, nowIso(), cid, companyId)
    .run();
  return c.json({ ok: true, response });
});

