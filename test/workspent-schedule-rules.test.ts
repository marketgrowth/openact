import { test } from "node:test";
import assert from "node:assert/strict";
import { arrival, bandOf, coverage, datesBetween, hourly, hoursShort, monthGrid, overlaps, scheduledMinutes, shiftTimes, weekMinutes, type ShiftInfo } from "../apps/workspent/src/shared/schedule.ts";

/* WorkSpent schedule rules: parts of the day, shift times, overlaps, week hours and coverage. */

const TZ = "America/Los_Angeles";
let n = 0;
function S(personId: string | null, date: string, start: string, end: string, extra: Partial<ShiftInfo> = {}): ShiftInfo {
  const t = shiftTimes(date, start, end, TZ);
  if ("problem" in t) throw new Error(t.problem);
  return { id: `s${++n}`, personId, ...t, breakMinutes: 30, note: "", status: "published", seriesKey: null, ...extra };
}

test("a shift belongs to a part of the day by its local start time", () => {
  assert.equal(bandOf(S("a", "2026-11-23", "07:00", "15:30").startsAt, TZ), "day");
  assert.equal(bandOf(S("a", "2026-11-23", "15:00", "23:30").startsAt, TZ), "evening");
  assert.equal(bandOf(S("a", "2026-11-23", "23:00", "07:30").startsAt, TZ), "night");
  assert.equal(bandOf(S("a", "2026-11-23", "04:59", "09:00").startsAt, TZ), "night");
});

test("an end time before the start time is on the next day, also across daylight saving time", () => {
  const night = S("a", "2026-11-23", "23:00", "07:30");
  assert.equal(night.startsAt, "2026-11-24T07:00:00.000Z");
  assert.equal(night.endsAt, "2026-11-24T15:30:00.000Z");
  assert.equal(scheduledMinutes(night), 8 * 60);
  // Clocks go back on November 1, 2026: the night is one hour longer.
  const fallBack = S("a", "2026-10-31", "23:00", "07:00");
  assert.equal((Date.parse(fallBack.endsAt) - Date.parse(fallBack.startsAt)) / 3_600_000, 9);
  const same = shiftTimes("2026-11-23", "08:00", "08:00", TZ);
  assert.ok(!("problem" in same) && (Date.parse(same.endsAt) - Date.parse(same.startsAt)) / 3_600_000 === 24);
});

test("touching shifts do not overlap", () => {
  const a = S("a", "2026-11-23", "07:00", "15:00");
  assert.equal(overlaps(a, S("a", "2026-11-23", "15:00", "23:00")), false);
  assert.equal(overlaps(a, S("a", "2026-11-23", "14:59", "23:00")), true);
});

test("week hours count Sunday to Saturday, without deleted shifts and open shifts", () => {
  const list = [
    S("a", "2026-11-22", "07:00", "15:30"),
    S("a", "2026-11-28", "07:00", "15:30"),
    S("a", "2026-11-29", "07:00", "15:30"),
    S("a", "2026-11-24", "07:00", "15:30", { status: "deleted" }),
    S(null, "2026-11-24", "07:00", "15:30")
  ];
  assert.deepEqual([...weekMinutes(list, "2026-11-25", TZ)], [["a", 16 * 60]]);
});

test("coverage counts shifts by part of the day, and a gap needs that part on another day", () => {
  const dates = datesBetween("2026-11-22", "2026-11-24");
  const list = [
    S("a", "2026-11-22", "07:00", "15:30"),
    S("b", "2026-11-22", "15:00", "23:30"),
    S("a", "2026-11-23", "07:00", "15:30"),
    S(null, "2026-11-23", "15:00", "23:30"),
    S("b", "2026-11-24", "15:00", "23:30", { status: "deleted" })
  ];
  const c = coverage(list, dates, TZ);
  assert.deepEqual(c[0]!.counts, { day: 1, evening: 1, night: 0 });
  assert.deepEqual(c[0]!.gaps, [], "nights are never used, so they are no gap");
  assert.deepEqual(c[1]!.gaps, ["evening"]);
  assert.equal(c[1]!.open, 1);
  assert.deepEqual(c[2]!.gaps, ["day", "evening"]);
  assert.equal(c[0]!.minutes, 16 * 60);
  assert.equal(c[0]!.people, 2);
});

test("hourly counts people on shift each local hour, with the night from the day before", () => {
  const h = hourly([S("a", "2026-11-22", "23:00", "07:30"), S("b", "2026-11-23", "07:00", "15:30")], "2026-11-23", TZ);
  assert.equal(h.length, 24);
  assert.equal(h[0], 1);
  assert.equal(h[7], 2);
  assert.equal(h[12], 1);
  assert.equal(h[16], 0);
});

test("arrival: on time with 5 minutes of grace, late, not in yet, upcoming and done", () => {
  const s = S("a", "2026-11-23", "07:00", "15:30");
  const start = Date.parse(s.startsAt);
  const at = (min: number) => new Date(start + min * 60_000).toISOString();
  assert.deepEqual(arrival(s, [at(4)], start + 60 * 60_000), { kind: "on_time", minutes: 4 });
  assert.deepEqual(arrival(s, [at(-10)], start + 60 * 60_000), { kind: "on_time", minutes: 0 });
  assert.deepEqual(arrival(s, [at(12)], start + 60 * 60_000), { kind: "late", minutes: 12 });
  assert.deepEqual(arrival(s, [], start + 20 * 60_000), { kind: "not_in", minutes: 20 });
  assert.deepEqual(arrival(s, [], start - 30 * 60_000), { kind: "upcoming", minutes: 30 });
  assert.equal(arrival(s, [at(1)], start + 10 * 3_600_000).kind, "done");
});

test("a month view shows whole weeks around the month", () => {
  assert.deepEqual(monthGrid("2026-11-23"), { from: "2026-11-01", to: "2026-12-05" });
  assert.deepEqual(monthGrid("2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
});

test("short hours drop trailing zeros", () => {
  assert.deepEqual([hoursShort(2400), hoursShort(450), hoursShort(495), hoursShort(0)], ["40", "7.5", "8.25", "0"]);
});
