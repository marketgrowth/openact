import { HttpError, authSecret, companyAppState, companyRole, appOffError, type Env } from "@openact/core/server";
import type { CompanyRole } from "@openact/core/shared";
import {
  APP_ID,
  DEVICE_ONLINE_MS,
  addDays,
  buildShifts,
  inPeriod,
  isDate,
  localDate,
  periodOf,
  personSheet,
  readLimits,
  recentPeriods,
  weekStart,
  type DeviceInfo,
  type DeviceKind,
  type LocationInfo,
  type Period,
  type PeriodKind,
  type PersonSheet,
  type PunchInfo,
  type PunchKind,
  type PunchRow,
  type PunchSource,
  type Shift
} from "../shared/rules.ts";

/*
 * WorkSpent data access: who can do what, rows to API shapes, and the timesheet of a location.
 * Every query names the company, so a row of another company never comes back.
 */

/* Access ------------------------------------------------------------ */

export interface Access {
  userId: string;
  role: CompanyRole;
  /** workspent.setup: locations, devices, people and PINs. */
  setup: boolean;
  /** workspent.manage: every location. */
  manageAll: boolean;
  /** Locations where the person is a location manager. */
  managed: Set<string>;
  /** workspent.clock: My time. */
  clock: boolean;
}

/** Checks that the person is in the company and that WorkSpent is on. Returns what they can do. */
export async function loadAccess(env: Env, companyId: string, userId: string): Promise<Access> {
  const [role, state] = await Promise.all([companyRole(env, companyId, userId), companyAppState(env, companyId)]);
  if (!role) throw new HttpError(404, "This company does not exist, or you are not in it.");
  if (!state.enabled(APP_ID)) throw appOffError(APP_ID, state);
  const has = (p: string) => state.roles(p).includes(role);
  const managed =
    role === "guest"
      ? []
      : (
          await env.DB.prepare("SELECT location_id FROM workspent_location_managers WHERE company_id = ? AND user_id = ?")
            .bind(companyId, userId)
            .all<{ location_id: string }>()
        ).results.map((r) => r.location_id);
  return {
    userId,
    role,
    setup: has("workspent.setup"),
    manageAll: has("workspent.manage"),
    managed: new Set(managed),
    clock: has("workspent.clock")
  };
}

export const canManage = (a: Access, locationId: string) => a.manageAll || a.managed.has(locationId);

export function requireSetup(a: Access): void {
  if (!a.setup)
    throw new HttpError(
      403,
      "Your role in this company does not allow this: Set up WorkSpent. Ask a company owner or admin to change it in Company settings.",
      "no_permission"
    );
}

export function requireManage(a: Access, locationId: string): void {
  if (!canManage(a, locationId))
    throw new HttpError(403, "You do not manage this location. Ask a company owner or admin to make you a manager of it.", "no_permission");
}

export function requireClock(a: Access): void {
  if (!a.clock)
    throw new HttpError(
      403,
      "Your role in this company does not allow this: Use WorkSpent. Ask a company owner or admin to change it in Company settings.",
      "no_permission"
    );
}

/* Secrets ----------------------------------------------------------- */

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The hash of a PIN. A PIN has few digits, so a plain hash is easy to reverse.
 * An HMAC with the server secret is not. The company id keeps equal PINs of two companies apart.
 */
export const pinHash = (env: Env, url: string, companyId: string, pin: string) => hmacHex(authSecret(env, url), `workspent-pin:${companyId}:${pin}`);

/** Compares two strings in time that does not depend on where they differ. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A random PIN with a number of digits, with no bias. */
export function randomPin(digits: number): string {
  const max = 10 ** digits;
  const limit = Math.floor(4_294_967_296 / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= limit);
  return String(n % max).padStart(digits, "0");
}

/* Locations --------------------------------------------------------- */

export interface LocationRow {
  id: string;
  company_id: string;
  name: string;
  time_zone: string;
  clock_rule: string;
  period_kind: PeriodKind;
  period_start_date: string;
  flags_json: string;
  is_archived: number;
}

export async function locationRow(env: Env, companyId: string, locationId: string): Promise<LocationRow> {
  const row = await env.DB.prepare("SELECT * FROM workspent_locations WHERE id = ? AND company_id = ?").bind(locationId, companyId).first<LocationRow>();
  if (!row) throw new HttpError(404, "This location does not exist. It may belong to another company.");
  return row;
}

export async function locationInfos(env: Env, companyId: string, access: Access, only?: string[]): Promise<LocationInfo[]> {
  const [locs, managers, devices, people] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM workspent_locations WHERE company_id = ? ORDER BY is_archived, name COLLATE NOCASE").bind(companyId),
    env.DB.prepare("SELECT location_id, user_id FROM workspent_location_managers WHERE company_id = ?").bind(companyId),
    env.DB.prepare("SELECT location_id, COUNT(*) AS n FROM workspent_devices WHERE company_id = ? AND is_active = 1 GROUP BY location_id").bind(companyId),
    env.DB.prepare(
      `SELECT pl.location_id, COUNT(*) AS n FROM workspent_person_locations pl JOIN workspent_people p ON p.id = pl.person_id
       WHERE pl.company_id = ? AND p.is_active = 1 GROUP BY pl.location_id`
    ).bind(companyId)
  ]);
  const count = (rows: unknown[], id: string) => (rows as Array<{ location_id: string; n: number }>).find((r) => r.location_id === id)?.n ?? 0;
  return (locs!.results as LocationRow[])
    .filter((l) => !only || only.includes(l.id))
    .map((l) => ({
      ...toLocation(l, canManage(access, l.id)),
      managerIds: (managers!.results as Array<{ location_id: string; user_id: string }>).filter((m) => m.location_id === l.id).map((m) => m.user_id),
      deviceCount: count(devices!.results, l.id),
      peopleCount: count(people!.results, l.id)
    }));
}

export function toLocation(l: LocationRow, manage: boolean): LocationInfo {
  return {
    id: l.id,
    name: l.name,
    timeZone: l.time_zone,
    clockRule: "on_site",
    periodKind: l.period_kind,
    periodStartDate: l.period_start_date,
    limits: readLimits(l.flags_json),
    isArchived: l.is_archived === 1,
    managerIds: [],
    deviceCount: 0,
    peopleCount: 0,
    canManage: manage
  };
}

/* Devices ----------------------------------------------------------- */

export interface DeviceRow {
  id: string;
  company_id: string;
  location_id: string;
  name: string;
  kind: DeviceKind;
  key_hash: string;
  last_seen_at: string | null;
  last_ip_address: string | null;
  wrong_pin_count: number;
  locked_until_ms: number | null;
  is_active: number;
}

export function toDevice(d: DeviceRow, nowMs: number): DeviceInfo {
  const locked = d.locked_until_ms && d.locked_until_ms > nowMs ? new Date(d.locked_until_ms).toISOString() : null;
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    lastSeenAt: d.last_seen_at,
    lastIpAddress: d.last_ip_address,
    online: d.is_active === 1 && !!d.last_seen_at && nowMs - Date.parse(d.last_seen_at) <= DEVICE_ONLINE_MS,
    isActive: d.is_active === 1,
    lockedUntil: locked
  };
}

/* Punches ----------------------------------------------------------- */

interface PunchDbRow {
  id: string;
  person_id: string;
  location_id: string;
  kind: PunchKind;
  punched_at: string;
  source: PunchSource;
  device_name: string | null;
  is_late_sync: number;
  is_deleted: number;
  changed: number;
  questioned: number;
}

const PUNCH_SELECT = `SELECT p.id, p.person_id, p.location_id, p.kind, p.punched_at, p.source, d.name AS device_name, p.is_late_sync, p.is_deleted,
  EXISTS (SELECT 1 FROM workspent_changes c WHERE c.punch_id = p.id) AS changed,
  EXISTS (SELECT 1 FROM workspent_changes c WHERE c.punch_id = p.id AND c.response = 'questioned') AS questioned
  FROM workspent_punches p LEFT JOIN workspent_devices d ON d.id = p.device_id`;

const toRow = (p: PunchDbRow): PunchRow => ({
  id: p.id,
  personId: p.person_id,
  locationId: p.location_id,
  kind: p.kind,
  at: p.punched_at,
  source: p.source,
  isLateSync: p.is_late_sync === 1,
  isDeleted: p.is_deleted === 1,
  changed: p.changed === 1,
  questioned: p.questioned === 1
});

export const toPunchInfo = (p: PunchDbRow): PunchInfo => ({
  id: p.id,
  kind: p.kind,
  at: p.punched_at,
  source: p.source,
  deviceName: p.device_name,
  isLateSync: p.is_late_sync === 1,
  isDeleted: p.is_deleted === 1
});

/** The UTC window to read punches for a period: the whole weeks around it, plus a day on each side for time zones. */
export function readWindow(period: Period): { from: string; to: string } {
  const from = addDays(weekStart(period.start), -2);
  const to = addDays(addDays(weekStart(period.end), 6), 2);
  return { from: from + "T00:00:00.000Z", to: to + "T23:59:59.999Z" };
}

export async function locationPunches(env: Env, companyId: string, locationId: string, period: Period, personId?: string) {
  const w = readWindow(period);
  const sql = `${PUNCH_SELECT} WHERE p.company_id = ? AND p.location_id = ? AND p.punched_at >= ? AND p.punched_at <= ?${personId ? " AND p.person_id = ?" : ""} ORDER BY p.punched_at`;
  const args: unknown[] = [companyId, locationId, w.from, w.to];
  if (personId) args.push(personId);
  return (await env.DB.prepare(sql).bind(...args).all<PunchDbRow>()).results;
}

/** The punches of a person in the last few days, at every location, for their clock state. */
export async function recentPersonPunches(env: Env, companyId: string, personId: string, nowMs: number): Promise<PunchRow[]> {
  const from = new Date(nowMs - 4 * 86_400_000).toISOString();
  const rows = await env.DB.prepare(`${PUNCH_SELECT} WHERE p.company_id = ? AND p.person_id = ? AND p.punched_at >= ? ORDER BY p.punched_at`)
    .bind(companyId, personId, from)
    .all<PunchDbRow>();
  return rows.results.map(toRow);
}

export function shiftsOf(rows: PunchDbRow[], tz: string, limitsJson: string, nowMs: number): Map<string, Shift[]> {
  const limits = readLimits(limitsJson);
  const byPerson = new Map<string, PunchRow[]>();
  for (const r of rows) {
    const list = byPerson.get(r.person_id) ?? [];
    list.push(toRow(r));
    byPerson.set(r.person_id, list);
  }
  const out = new Map<string, Shift[]>();
  for (const [id, list] of byPerson) out.set(id, buildShifts(list, tz, limits, nowMs));
  return out;
}

/* Periods ----------------------------------------------------------- */

export interface PeriodRow {
  start_date: string;
  end_date: string;
  status: "approved" | "open";
  approved_by: string | null;
  approved_at: string | null;
}

export async function approvedPeriods(env: Env, companyId: string, locationId: string): Promise<PeriodRow[]> {
  return (
    await env.DB.prepare("SELECT start_date, end_date, status, approved_by, approved_at FROM workspent_periods WHERE company_id = ? AND location_id = ?")
      .bind(companyId, locationId)
      .all<PeriodRow>()
  ).results;
}

/** The period that starts on `start`, or the current period when `start` is empty. Refuses a date that does not start a period. */
export function pickPeriod(loc: LocationRow, start: string | undefined, nowMs: number): Period {
  const today = localDate(nowMs, loc.time_zone);
  if (!start) return periodOf(today, loc.period_kind, loc.period_start_date);
  if (!isDate(start)) throw new HttpError(400, "A pay period starts on a date like 2026-11-16.");
  const p = periodOf(start, loc.period_kind, loc.period_start_date);
  if (p.start !== start) throw new HttpError(400, `No pay period starts on ${start}. Pick a period from the list.`);
  if (p.start > today) throw new HttpError(400, "That pay period has not started yet.");
  return p;
}

export function periodList(loc: LocationRow, saved: PeriodRow[], nowMs: number): Array<Period & { status: "open" | "approved" }> {
  const today = localDate(nowMs, loc.time_zone);
  return recentPeriods(today, loc.period_kind, loc.period_start_date, 8).map((p) => ({
    ...p,
    status: saved.find((s) => s.start_date === p.start && s.status === "approved") ? "approved" : "open"
  }));
}

/** True when a local date is inside an approved period. */
export const isLocked = (saved: PeriodRow[], date: string) => saved.some((s) => s.status === "approved" && inPeriod(date, { start: s.start_date, end: s.end_date }));

/* Timesheets -------------------------------------------------------- */

export interface PersonLite {
  id: string;
  name: string;
  user_id: string | null;
}

/** People at a location, and anyone with punches there in the window. */
export async function sheetPeople(env: Env, companyId: string, locationId: string, punchPersonIds: string[]): Promise<PersonLite[]> {
  const assigned = await env.DB.prepare(
    `SELECT p.id, p.name, p.user_id FROM workspent_people p JOIN workspent_person_locations pl ON pl.person_id = p.id
     WHERE pl.location_id = ? AND p.company_id = ? AND p.is_active = 1`
  )
    .bind(locationId, companyId)
    .all<PersonLite>();
  const list = [...assigned.results];
  const missing = punchPersonIds.filter((id) => !list.some((p) => p.id === id));
  if (missing.length) {
    const more = await env.DB.prepare(`SELECT id, name, user_id FROM workspent_people WHERE company_id = ? AND id IN (${missing.map(() => "?").join(",")})`)
      .bind(companyId, ...missing)
      .all<PersonLite>();
    list.push(...more.results);
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export interface LocationSheet {
  people: PersonLite[];
  sheets: Map<string, PersonSheet>;
  shifts: Map<string, Shift[]>;
  rows: PunchDbRow[];
}

export async function locationSheet(env: Env, loc: LocationRow, period: Period, nowMs: number): Promise<LocationSheet> {
  const rows = await locationPunches(env, loc.company_id, loc.id, period);
  const shifts = shiftsOf(rows, loc.time_zone, loc.flags_json, nowMs);
  const people = await sheetPeople(env, loc.company_id, loc.id, [...shifts.keys()]);
  const limits = readLimits(loc.flags_json);
  const sheets = new Map<string, PersonSheet>();
  for (const p of people) sheets.set(p.id, personSheet(p.id, shifts.get(p.id) ?? [], period, limits));
  return { people, sheets, shifts, rows };
}
