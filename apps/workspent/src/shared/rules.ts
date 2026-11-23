/*
 * WorkSpent rules that the server and the web app share: types, time zones, pay periods,
 * shifts and hours, flags and the CSV export.
 * This file has no imports, so the tests load it directly.
 */

export const APP_ID = "workspent";
export const API = "/api/apps/workspent";
export const HOME = "/a/workspent";
export const CLOCK_PATH = "/a/workspent/clock";
/** The header that carries the device key on time clock device requests. */
export const DEVICE_HEADER = "x-workspent-device";
/** Where the time clock device keeps its key and its offline queue. */
export const DEVICE_STORAGE = "openact.workspent.device";
export const QUEUE_STORAGE = "openact.workspent.queue";

export const PUNCH_KINDS = ["in", "break_start", "break_end", "out"] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];
export const PUNCH_LABELS: Record<PunchKind, string> = {
  in: "Clock in",
  break_start: "Start meal break",
  break_end: "End meal break",
  out: "Clock out"
};
export const PUNCH_DONE: Record<PunchKind, string> = {
  in: "You clocked in",
  break_start: "Your meal break started",
  break_end: "Your meal break ended",
  out: "You clocked out"
};

export const SOURCES = ["device", "phone", "computer", "manager"] as const;
export type PunchSource = (typeof SOURCES)[number];

export const PERIOD_KINDS = ["weekly", "biweekly", "semimonthly"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const PERIOD_LABELS: Record<PeriodKind, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month (1st to 15th, 16th to month end)"
};

export const DEVICE_KINDS = ["tablet", "computer"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** PIN rules. */
export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const PIN_TRIES = 5;
export const PIN_LOCK_MS = 15 * 60_000;

/** A device counts as online when it reported in the last 5 minutes. It reports every 2 minutes. */
export const DEVICE_ONLINE_MS = 5 * 60_000;
export const DEVICE_HEARTBEAT_MS = 2 * 60_000;
/** The oldest clock-in that a device can send late. */
export const LATE_SYNC_MAX_MS = 24 * 3_600_000;

/* ------------------------------------------------------------------ */
/* Flags                                                               */
/* ------------------------------------------------------------------ */

export interface FlagLimits {
  /** Flag a day with more hours than this. */
  dayHours: number;
  /** Flag a week (Sunday to Saturday) with more hours than this. */
  weekHours: number;
  /** Flag a shift longer than this with no meal break that starts by then. */
  mealAfterHours: number;
  /** Flag a shift with no clock-out after this many hours. */
  missedOutHours: number;
}

export const DEFAULT_LIMITS: FlagLimits = { dayHours: 8, weekHours: 40, mealAfterHours: 5, missedOutHours: 14 };

export const LIMIT_RANGES: Record<keyof FlagLimits, { min: number; max: number; label: string }> = {
  dayHours: { min: 1, max: 24, label: "Hours in a day" },
  weekHours: { min: 1, max: 168, label: "Hours in a week" },
  mealAfterHours: { min: 1, max: 24, label: "Hours before a meal break" },
  missedOutHours: { min: 1, max: 48, label: "Hours before a missed clock-out" }
};

/** The saved limits, with defaults for missing or bad values. */
export function readLimits(json: string | null | undefined): FlagLimits {
  let raw: Record<string, unknown> = {};
  try {
    const v = JSON.parse(json || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) raw = v as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(DEFAULT_LIMITS) as Array<keyof FlagLimits>) {
    const n = raw[k];
    const r = LIMIT_RANGES[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= r.min && n <= r.max) out[k] = n;
  }
  return out;
}

/** Checks new limits. Returns a problem in plain words, or the limits. */
export function cleanLimits(v: unknown): { limits: FlagLimits } | { problem: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { problem: "Send the flag limits as an object." };
  const raw = v as Record<string, unknown>;
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(DEFAULT_LIMITS) as Array<keyof FlagLimits>) {
    if (raw[k] === undefined) continue;
    const n = raw[k];
    const r = LIMIT_RANGES[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < r.min || n > r.max)
      return { problem: `${r.label} must be a number from ${r.min} to ${r.max}.` };
    out[k] = Math.round(n * 4) / 4;
  }
  return { limits: out };
}

export const FLAG_IDS = ["over_day", "over_week", "no_meal", "missed_out", "missed_in", "late_sync", "questioned"] as const;
export type FlagId = (typeof FLAG_IDS)[number];
export const FLAG_LABELS: Record<FlagId, string> = {
  over_day: "Over the day limit",
  over_week: "Over the week limit",
  no_meal: "No meal break",
  missed_out: "Missed clock-out",
  missed_in: "Missed clock-in",
  late_sync: "Sent late (device was offline)",
  questioned: "Questioned by the person"
};

/* ------------------------------------------------------------------ */
/* Dates and time zones                                                */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

export function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && dateOk(s);
}
function dateOk(s: string): boolean {
  return new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
}

export function isTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export const dayNumber = (date: string) => Math.floor(Date.parse(date + "T00:00:00Z") / DAY_MS);
export const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => fromDayNumber(dayNumber(date) + days);
/** 0 is Sunday. */
export const weekday = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();

/** True when the time zone is a real IANA name that this runtime knows. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** The wall clock in a time zone: date as YYYY-MM-DD and time as HH:MM. */
export function wallClock(ms: number, tz: string): { date: string; time: string; seconds: number } {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, seconds: Number(p.second) };
}

export const localDate = (ms: number, tz: string) => wallClock(ms, tz).date;

/** The time zone offset in ms at an instant (local minus UTC). */
function offsetAt(ms: number, tz: string): number {
  const w = wallClock(ms, tz);
  const asUtc = Date.parse(`${w.date}T${w.time}:00Z`) + w.seconds * 1000;
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant for a wall clock date and time in a time zone.
 * In the hour that a clock skips (spring forward), the time moves forward. In the hour that repeats, the first one wins.
 */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  let ms = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(ms, tz);
  if (second !== ms) {
    // Near a change. Prefer the earlier instant that shows the same wall clock.
    const w = wallClock(second, tz);
    ms = w.date === date && w.time === time ? Math.min(ms, second) : Math.max(ms, second);
  }
  return ms;
}

/* ------------------------------------------------------------------ */
/* Pay periods                                                         */
/* ------------------------------------------------------------------ */

export interface Period {
  start: string;
  end: string;
}

/** The pay period that holds a date. Weekly and biweekly periods count from the location's start date. */
export function periodOf(date: string, kind: PeriodKind, anchor: string): Period {
  if (kind === "semimonthly") {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const mm = String(m).padStart(2, "0");
    if (d <= 15) return { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` };
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start: `${y}-${mm}-16`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }
  const len = kind === "weekly" ? 7 : 14;
  const diff = dayNumber(date) - dayNumber(anchor);
  const k = Math.floor(diff / len);
  const start = addDays(anchor, k * len);
  return { start, end: addDays(start, len - 1) };
}

/** The period before or after one period. */
export function nextPeriod(p: Period, kind: PeriodKind, anchor: string, step: 1 | -1): Period {
  return periodOf(step === 1 ? addDays(p.end, 1) : addDays(p.start, -1), kind, anchor);
}

/** The current period and the ones before it, newest first. */
export function recentPeriods(today: string, kind: PeriodKind, anchor: string, count: number): Period[] {
  const out: Period[] = [];
  let p = periodOf(today, kind, anchor);
  for (let i = 0; i < count; i++) {
    out.push(p);
    p = nextPeriod(p, kind, anchor, -1);
  }
  return out;
}

export const inPeriod = (date: string, p: Period) => date >= p.start && date <= p.end;

/** The Sunday that starts the week of a date. Weeks run Sunday to Saturday. */
export const weekStart = (date: string) => addDays(date, -weekday(date));

/* ------------------------------------------------------------------ */
/* Shifts and hours                                                    */
/* ------------------------------------------------------------------ */

export interface PunchRow {
  id: string;
  personId: string;
  locationId: string;
  kind: PunchKind;
  /** ISO 8601 in UTC. */
  at: string;
  source: PunchSource;
  isLateSync: boolean;
  isDeleted: boolean;
  /** True when a manager added or changed it. */
  changed: boolean;
  /** True when the person questioned a fix of it. */
  questioned: boolean;
}

export interface Shift {
  personId: string;
  locationId: string;
  /** The local date of the clock-in (or of the clock-out when the clock-in is missing). */
  date: string;
  inAt: string | null;
  outAt: string | null;
  breaks: Array<{ start: string; end: string | null }>;
  breakMinutes: number;
  /** Worked minutes. 0 until the shift has both a clock-in and a clock-out. */
  minutes: number;
  /** True while the person is on the clock. */
  open: boolean;
  onBreak: boolean;
  punchIds: string[];
  flags: FlagId[];
  changed: boolean;
}

const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

/**
 * Builds the shifts of one person from their punches. Deleted punches do not count.
 * A clock-in while a shift is open ends that shift with a missed clock-out.
 * A break or clock-out with no clock-in before it makes a shift with a missed clock-in.
 * A break that is still open at the clock-out ends at the clock-out.
 */
export function buildShifts(punches: PunchRow[], tz: string, limits: FlagLimits, nowMs: number): Shift[] {
  const list = punches.filter((p) => !p.isDeleted).sort((a, b) => a.at.localeCompare(b.at) || order(a.kind) - order(b.kind));
  const shifts: Shift[] = [];
  let cur: Shift | null = null;
  let lateSync = false;
  let questioned = false;

  const start = (p: PunchRow, inAt: string | null): Shift => ({
    personId: p.personId,
    locationId: p.locationId,
    date: localDate(Date.parse(p.at), tz),
    inAt,
    outAt: null,
    breaks: [],
    breakMinutes: 0,
    minutes: 0,
    open: true,
    onBreak: false,
    punchIds: [],
    flags: inAt ? [] : ["missed_in"],
    changed: false
  });
  const add = (s: Shift, p: PunchRow) => {
    s.punchIds.push(p.id);
    if (p.changed) s.changed = true;
    if (p.isLateSync) lateSync = true;
    if (p.questioned) questioned = true;
  };
  const finish = (s: Shift, missedOut: boolean) => {
    s.open = false;
    s.onBreak = false;
    if (missedOut && !s.flags.includes("missed_out")) s.flags.push("missed_out");
    if (lateSync) s.flags.push("late_sync");
    if (questioned) s.flags.push("questioned");
    lateSync = false;
    questioned = false;
    totals(s, limits);
    shifts.push(s);
  };

  for (const p of list) {
    if (p.kind === "in") {
      if (cur) finish(cur, true);
      cur = start(p, p.at);
      add(cur, p);
      continue;
    }
    if (!cur) {
      // A break or a clock-out with no clock-in.
      cur = start(p, null);
    }
    add(cur, p);
    const openBreak = cur.breaks.find((b) => b.end === null);
    if (p.kind === "break_start") {
      if (!openBreak) cur.breaks.push({ start: p.at, end: null });
      cur.onBreak = true;
    } else if (p.kind === "break_end") {
      if (openBreak) openBreak.end = p.at;
      cur.onBreak = false;
    } else {
      if (openBreak) openBreak.end = p.at;
      cur.outAt = p.at;
      finish(cur, false);
      cur = null;
    }
  }
  if (cur) {
    const since = cur.inAt ?? cur.breaks[0]?.start ?? null;
    const tooLong = since !== null && (nowMs - Date.parse(since)) / 3_600_000 > limits.missedOutHours;
    if (tooLong || !cur.inAt) {
      finish(cur, tooLong);
    } else {
      if (lateSync) cur.flags.push("late_sync");
      if (questioned) cur.flags.push("questioned");
      totals(cur, limits);
      shifts.push(cur);
    }
  }
  return shifts;
}

function order(k: PunchKind): number {
  return PUNCH_KINDS.indexOf(k);
}

function totals(s: Shift, limits: FlagLimits): void {
  s.breakMinutes = Math.round(s.breaks.reduce((n, b) => n + (b.end ? Math.max(0, minutesBetween(b.start, b.end)) : 0), 0));
  if (s.inAt && s.outAt) {
    s.minutes = Math.max(0, Math.round(minutesBetween(s.inAt, s.outAt)) - s.breakMinutes);
    const mealBy = limits.mealAfterHours * 60;
    const firstBreak = s.breaks[0];
    const breakInTime = firstBreak && minutesBetween(s.inAt, firstBreak.start) <= mealBy;
    if (s.minutes > mealBy && !breakInTime && !s.flags.includes("no_meal")) s.flags.push("no_meal");
  } else {
    s.minutes = 0;
  }
}

/** The state of a person now, from their shifts: what the PIN pad offers. */
export type ClockState = "out" | "in" | "on_break";

export function clockState(shifts: Shift[]): { state: ClockState; since: string | null } {
  const last = shifts[shifts.length - 1];
  if (!last || !last.open) return { state: "out", since: last?.outAt ?? null };
  if (last.onBreak) return { state: "on_break", since: last.breaks[last.breaks.length - 1]?.start ?? null };
  return { state: "in", since: last.inAt };
}

/** The buttons for each state. */
export function allowedKinds(state: ClockState): PunchKind[] {
  if (state === "out") return ["in"];
  if (state === "in") return ["break_start", "out"];
  return ["break_end", "out"];
}

/* ------------------------------------------------------------------ */
/* Timesheet                                                           */
/* ------------------------------------------------------------------ */

export interface DayTotal {
  date: string;
  minutes: number;
  /** Minutes over the day limit. */
  overMinutes: number;
}

export interface PersonSheet {
  personId: string;
  shifts: Shift[];
  days: DayTotal[];
  minutes: number;
  overDayMinutes: number;
  overWeekMinutes: number;
  /** Week start (Sunday) to minutes over the week limit. */
  weeksOver: Record<string, number>;
  flagCount: number;
}

/**
 * The timesheet of one person for a period. `shifts` must hold every shift of the weeks that touch the period,
 * so the week totals are right at the period edges.
 */
export function personSheet(personId: string, shifts: Shift[], period: Period, limits: FlagLimits): PersonSheet {
  const byDay = new Map<string, number>();
  const byWeek = new Map<string, number>();
  for (const s of shifts) {
    byWeek.set(weekStart(s.date), (byWeek.get(weekStart(s.date)) ?? 0) + s.minutes);
    if (inPeriod(s.date, period)) byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.minutes);
  }
  const days: DayTotal[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => ({ date, minutes, overMinutes: Math.max(0, minutes - Math.round(limits.dayHours * 60)) }));
  // A week can cross two periods. Its minutes over the limit count once, in the period that holds its Saturday.
  // Its shifts get the flag in both periods.
  const weekLimit = Math.round(limits.weekHours * 60);
  const weeksOver: Record<string, number> = {};
  for (const [w, minutes] of byWeek) if (minutes > weekLimit && inPeriod(addDays(w, 6), period)) weeksOver[w] = minutes - weekLimit;
  const inside = shifts.filter((s) => inPeriod(s.date, period));
  // The day flag goes on the shifts of a day over the limit.
  // The week flag goes on the shift that takes the week over the limit, and on each shift after it in that week.
  const running = new Map<string, number>();
  const ordered = [...shifts].sort((a, b) => (a.inAt ?? a.outAt ?? a.date).localeCompare(b.inAt ?? b.outAt ?? b.date));
  const overWeek = new Set<Shift>();
  for (const s of ordered) {
    const w = weekStart(s.date);
    const total = (running.get(w) ?? 0) + s.minutes;
    running.set(w, total);
    if (total > weekLimit && s.minutes > 0) overWeek.add(s);
  }
  for (const s of inside) {
    const day = days.find((d) => d.date === s.date);
    if (day && day.overMinutes > 0 && !s.flags.includes("over_day")) s.flags.push("over_day");
    if (overWeek.has(s) && !s.flags.includes("over_week")) s.flags.push("over_week");
  }
  const overDayMinutes = days.reduce((n, d) => n + d.overMinutes, 0);
  const overWeekMinutes = Object.values(weeksOver).reduce((n, m) => n + m, 0);
  const flagCount = inside.reduce((n, s) => n + s.flags.length, 0);
  return { personId, shifts: inside, days, minutes: days.reduce((n, d) => n + d.minutes, 0), overDayMinutes, overWeekMinutes, weeksOver, flagCount };
}

/** Hours as text with two decimals, such as 7.50. */
export const hoursText = (minutes: number) => (minutes / 60).toFixed(2);

/** "7 h 30 min" style text. */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ------------------------------------------------------------------ */
/* PINs                                                                */
/* ------------------------------------------------------------------ */

/** Returns a problem in plain words, or null when the PIN is good. */
export function pinProblem(pin: unknown): string | null {
  if (typeof pin !== "string" || !/^\d+$/.test(pin)) return "A PIN has digits only.";
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return `A PIN has ${PIN_MIN} to ${PIN_MAX} digits.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** One CSV cell. A cell that starts with = + - @ gets a leading apostrophe, so a spreadsheet does not run it. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: Array<string | number>) => cells.map(csvCell).join(",");

export const CSV_HEADER = [
  "Person",
  "Location",
  "Date",
  "Clock in",
  "Clock out",
  "Break minutes",
  "Worked minutes",
  "Hours",
  "Flags",
  "Manager changes"
];

/** Local "YYYY-MM-DD HH:MM" for the CSV, or empty. */
export function csvTime(iso: string | null, tz: string): string {
  if (!iso) return "";
  const w = wallClock(Date.parse(iso), tz);
  return `${w.date} ${w.time}`;
}

/* ------------------------------------------------------------------ */
/* API shapes                                                          */
/* ------------------------------------------------------------------ */

export interface LocationInfo {
  id: string;
  name: string;
  timeZone: string;
  clockRule: "on_site";
  periodKind: PeriodKind;
  periodStartDate: string;
  limits: FlagLimits;
  isArchived: boolean;
  managerIds: string[];
  deviceCount: number;
  peopleCount: number;
  /** True when the person who asked can manage this location. */
  canManage: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
  lastSeenAt: string | null;
  lastIpAddress: string | null;
  online: boolean;
  isActive: boolean;
  lockedUntil: string | null;
}

export interface PersonInfo {
  id: string;
  name: string;
  userId: string | null;
  email: string | null;
  hasPin: boolean;
  isActive: boolean;
  locationIds: string[];
}

export interface Me {
  canSetup: boolean;
  canManageAll: boolean;
  managedLocationIds: string[];
  /** The WorkSpent person linked to this account, if any. */
  personId: string | null;
  canClock: boolean;
}

export interface ChangeInfo {
  id: string;
  punchId: string;
  action: "add" | "change" | "delete";
  oldAt: string | null;
  newAt: string | null;
  kind: PunchKind;
  reason: string;
  changedBy: string | null;
  changedAt: string;
  response: "confirmed" | "questioned" | null;
  responseNote: string | null;
}

export interface PunchInfo {
  id: string;
  kind: PunchKind;
  at: string;
  source: PunchSource;
  deviceName: string | null;
  isLateSync: boolean;
  isDeleted: boolean;
}

export interface SheetRow {
  person: { id: string; name: string; isSelf: boolean };
  sheet: PersonSheet;
}

export interface TimesheetData {
  location: LocationInfo;
  period: Period;
  periods: Array<Period & { status: "open" | "approved" }>;
  status: "open" | "approved";
  /** True after the last day of the period, in the location's time zone. Only an ended period can be approved. */
  ended: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  canReopen: boolean;
  rows: SheetRow[];
  onClock: Array<{ personId: string; name: string; state: ClockState; since: string | null; source: string }>;
  devices: { online: number; total: number };
}

export interface PersonDetail {
  person: { id: string; name: string; isSelf: boolean };
  location: LocationInfo;
  period: Period;
  status: "open" | "approved";
  punches: PunchInfo[];
  changes: ChangeInfo[];
  sheet: PersonSheet;
  state: { state: ClockState; since: string | null };
}

export interface MyTime {
  person: { id: string; name: string } | null;
  locations: Array<{
    location: { id: string; name: string; timeZone: string };
    period: Period;
    sheet: PersonSheet;
    punches: PunchInfo[];
  }>;
  changes: Array<ChangeInfo & { locationName: string; timeZone: string }>;
}

export interface DeviceHello {
  device: { name: string; kind: DeviceKind };
  location: { name: string; timeZone: string };
  serverTime: string;
  lockedUntil: string | null;
}

export interface PinAnswer {
  person: { name: string };
  state: ClockState;
  since: string | null;
  kinds: PunchKind[];
}
