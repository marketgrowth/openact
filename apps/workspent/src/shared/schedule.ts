/*
 * WorkSpent schedule rules that the server and the web app share: parts of the day, shift hours, overlaps,
 * weekly totals and coverage. This file imports only rules.ts, so the tests load it directly.
 */
import { addDays, localDate, wallClock, weekStart, zonedToUtc, type LocationInfo } from "./rules.ts";

/** Parts of the day, by the local start time of a shift. */
export const BANDS = ["day", "evening", "night"] as const;
export type Band = (typeof BANDS)[number];
export const BAND_LABELS: Record<Band, string> = { day: "Day", evening: "Evening", night: "Night" };
export const BAND_HELP: Record<Band, string> = { day: "starts 5 AM to 1 PM", evening: "starts 1 PM to 9 PM", night: "starts 9 PM to 5 AM" };

/** Quick times in the shift editor. */
export const QUICK_TIMES: Array<{ band: Band; start: string; end: string; label: string }> = [
  { band: "day", start: "07:00", end: "15:30", label: "Day 7:00 AM to 3:30 PM" },
  { band: "evening", start: "15:00", end: "23:30", label: "Evening 3:00 to 11:30 PM" },
  { band: "night", start: "23:00", end: "07:30", label: "Night 11:00 PM to 7:30 AM" }
];

export const BREAK_CHOICES = [0, 15, 30, 45, 60] as const;
/** The longest shift. */
export const MAX_SHIFT_HOURS = 24;
/** The most weeks a shift can repeat after the first one. */
export const MAX_REPEAT_WEEKS = 12;
/** The longest range one schedule read can cover. */
export const MAX_RANGE_DAYS = 42;

export type ShiftStatus = "draft" | "published" | "changed" | "deleted";
export const STATUS_LABELS: Record<ShiftStatus, string> = {
  draft: "Draft",
  published: "Published",
  changed: "Changed, not published",
  deleted: "Deleted, not published"
};

/** A scheduled shift. A shift with no person is an open shift. */
export interface ShiftInfo {
  id: string;
  personId: string | null;
  /** ISO 8601 in UTC. */
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  note: string;
  status: ShiftStatus;
  seriesKey: string | null;
}

/** The part of the day a shift belongs to, from its local start time. */
export function bandOf(startsAt: string, tz: string): Band {
  const h = Number(wallClock(Date.parse(startsAt), tz).time.slice(0, 2));
  if (h >= 5 && h < 13) return "day";
  if (h >= 13 && h < 21) return "evening";
  return "night";
}

/** The local date a shift belongs to: the date it starts. */
export const shiftDate = (startsAt: string, tz: string) => localDate(Date.parse(startsAt), tz);

/** Scheduled minutes: the shift length less the meal break. */
export function scheduledMinutes(s: { startsAt: string; endsAt: string; breakMinutes: number }): number {
  return Math.max(0, Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60_000) - s.breakMinutes);
}

/**
 * The start and end of a shift from a local date and times. An end time at or before the start time is on the next day.
 * Returns a problem in plain words, or the times.
 */
export function shiftTimes(date: string, start: string, end: string, tz: string): { startsAt: string; endsAt: string } | { problem: string } {
  const s = zonedToUtc(date, start, tz);
  let e = zonedToUtc(date, end, tz);
  if (e <= s) e = zonedToUtc(addDays(date, 1), end, tz);
  if (e - s > MAX_SHIFT_HOURS * 3_600_000) return { problem: `A shift can be ${MAX_SHIFT_HOURS} hours long at most.` };
  return { startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() };
}

/** True when two shifts share any time. Touching ends do not overlap. */
export const overlaps = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Scheduled minutes of each person in the week (Sunday to Saturday) that holds `date`. Deleted shifts do not count. */
export function weekMinutes(shifts: ShiftInfo[], date: string, tz: string): Map<string, number> {
  const ws = weekStart(date);
  const we = addDays(ws, 6);
  const out = new Map<string, number>();
  for (const s of shifts) {
    if (!s.personId || s.status === "deleted") continue;
    const d = shiftDate(s.startsAt, tz);
    if (d < ws || d > we) continue;
    out.set(s.personId, (out.get(s.personId) ?? 0) + scheduledMinutes(s));
  }
  return out;
}

export interface DayCoverage {
  date: string;
  counts: Record<Band, number>;
  /** Parts of the day with no shift, although the location staffs them on another day of the range. */
  gaps: Band[];
  open: number;
  minutes: number;
  people: number;
}

/**
 * Coverage for each date: how many shifts start in each part of the day.
 * A part of the day counts as a gap only when another day in the range has a shift in it,
 * so an office with no night shifts never shows night gaps.
 */
export function coverage(shifts: ShiftInfo[], dates: string[], tz: string): DayCoverage[] {
  const live = shifts.filter((s) => s.status !== "deleted");
  const used = new Set<Band>();
  const rows = dates.map((date) => {
    const counts: Record<Band, number> = { day: 0, evening: 0, night: 0 };
    const people = new Set<string>();
    let open = 0;
    let minutes = 0;
    for (const s of live) {
      if (shiftDate(s.startsAt, tz) !== date) continue;
      if (!s.personId) {
        open++;
        continue;
      }
      const b = bandOf(s.startsAt, tz);
      counts[b]++;
      used.add(b);
      people.add(s.personId);
      minutes += scheduledMinutes(s);
    }
    return { date, counts, gaps: [] as Band[], open, minutes, people: people.size };
  });
  for (const r of rows) r.gaps = BANDS.filter((b) => used.has(b) && r.counts[b] === 0);
  return rows;
}

/** People on shift in each hour of a local date: 24 numbers. */
export function hourly(shifts: ShiftInfo[], date: string, tz: string): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (let h = 0; h < 24; h++) {
    const from = zonedToUtc(date, `${String(h).padStart(2, "0")}:00`, tz);
    const to = from + 3_600_000;
    for (const s of shifts) {
      if (!s.personId || s.status === "deleted") continue;
      if (Date.parse(s.startsAt) < to && Date.parse(s.endsAt) > from) out[h]!++;
    }
  }
  return out;
}

/** How a person did against a shift: for the day view. Five minutes of grace. */
export type Arrival = "upcoming" | "on_time" | "late" | "not_in" | "done";

export function arrival(shift: { startsAt: string; endsAt: string }, clockIns: string[], nowMs: number, graceMin = 5): { kind: Arrival; minutes: number } {
  const start = Date.parse(shift.startsAt);
  const end = Date.parse(shift.endsAt);
  const near = clockIns.map((t) => Date.parse(t)).filter((t) => t >= start - 2 * 3_600_000 && t < end).sort((a, b) => a - b)[0];
  if (near !== undefined) {
    const late = Math.round((near - start) / 60_000);
    if (nowMs >= end) return { kind: "done", minutes: Math.max(0, late) };
    return late > graceMin ? { kind: "late", minutes: late } : { kind: "on_time", minutes: Math.max(0, late) };
  }
  if (nowMs < start) return { kind: "upcoming", minutes: Math.round((start - nowMs) / 60_000) };
  return { kind: "not_in", minutes: Math.round((nowMs - start) / 60_000) };
}

/** Hours with no trailing zeros, such as 40, 7.5 or 8.25. */
export const hoursShort = (minutes: number) => String(Number((minutes / 60).toFixed(2)));

/** The dates of a range, from and to included. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The six weeks shown by a month view: Sunday before the 1st to the Saturday after the last day. */
export function monthGrid(month: string): { from: string; to: string } {
  const first = month.slice(0, 7) + "-01";
  const [y, m] = first.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: weekStart(first), to: addDays(weekStart(last), 6) };
}

/** The schedule of a location for a range of dates. */
export interface ScheduleData {
  location: LocationInfo;
  from: string;
  to: string;
  /** Today at the location. */
  today: string;
  now: string;
  /** The week flag limit of the location, in minutes. */
  weekLimitMinutes: number;
  people: Array<{ id: string; name: string; isActive: boolean }>;
  shifts: ShiftInfo[];
  /** Hours worked from the time clock, as shifts of clock-ins. */
  worked: Array<{ personId: string; date: string; inAt: string | null; outAt: string | null; open: boolean; minutes: number }>;
  clockIns: Array<{ personId: string; at: string }>;
  /** Shifts in the range that are not published yet: drafts, changes and deletes. */
  unpublished: number;
  canSetup: boolean;
}
