import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIMITS,
  buildShifts,
  cleanLimits,
  clockState,
  csvCell,
  csvRow,
  localDate,
  periodOf,
  personSheet,
  pinProblem,
  readLimits,
  recentPeriods,
  wallClock,
  zonedToUtc,
  type PunchKind,
  type PunchRow
} from "../apps/workspent/src/shared/rules.ts";

/* WorkSpent rules: pay periods, time zones, shifts, hours, flags, PINs and the CSV. */

let n = 0;
const P = (kind: PunchKind, at: string, extra: Partial<PunchRow> = {}): PunchRow => ({
  id: `p${++n}`,
  personId: "x",
  locationId: "l",
  kind,
  at,
  source: "device",
  isLateSync: false,
  isDeleted: false,
  changed: false,
  questioned: false,
  ...extra
});
const NOW = Date.parse("2026-11-23T12:00:00Z");

test("weekly and biweekly periods repeat from the start date, also before it", () => {
  assert.deepEqual(periodOf("2026-11-18", "weekly", "2026-11-15"), { start: "2026-11-15", end: "2026-11-21" });
  assert.deepEqual(periodOf("2026-11-22", "weekly", "2026-11-15"), { start: "2026-11-22", end: "2026-11-28" });
  assert.deepEqual(periodOf("2026-11-28", "biweekly", "2026-11-15"), { start: "2026-11-15", end: "2026-11-28" });
  assert.deepEqual(periodOf("2026-11-29", "biweekly", "2026-11-15"), { start: "2026-11-29", end: "2026-12-12" });
  assert.deepEqual(periodOf("2026-11-14", "biweekly", "2026-11-15"), { start: "2026-11-01", end: "2026-11-14" });
});

test("twice-a-month periods end on the 15th and the last day of the month", () => {
  assert.deepEqual(periodOf("2026-02-20", "semimonthly", "2026-01-01"), { start: "2026-02-16", end: "2026-02-28" });
  assert.deepEqual(periodOf("2028-02-29", "semimonthly", "2026-01-01"), { start: "2028-02-16", end: "2028-02-29" });
  assert.deepEqual(periodOf("2026-12-15", "semimonthly", "2026-01-01"), { start: "2026-12-01", end: "2026-12-15" });
  const list = recentPeriods("2026-03-02", "semimonthly", "2026-01-01", 3);
  assert.deepEqual(
    list.map((p) => p.start),
    ["2026-03-01", "2026-02-16", "2026-02-01"]
  );
});

test("local dates and times follow the time zone, also across daylight saving time", () => {
  assert.equal(localDate(Date.parse("2026-11-19T06:30:00Z"), "America/Los_Angeles"), "2026-11-18");
  assert.equal(localDate(Date.parse("2026-11-19T06:30:00Z"), "Asia/Manila"), "2026-11-19");
  assert.equal(new Date(zonedToUtc("2026-11-18", "22:30", "America/Los_Angeles")).toISOString(), "2026-11-19T06:30:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-07-01", "09:00", "America/Los_Angeles")).toISOString(), "2026-07-01T16:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-11-19", "05:02", "Asia/Manila")).toISOString(), "2026-11-18T21:02:00.000Z");
  // 2:30 AM does not exist on March 8, 2026 in Los Angeles. The time moves forward to 3:30 AM PDT.
  const skipped = zonedToUtc("2026-03-08", "02:30", "America/Los_Angeles");
  assert.equal(wallClock(skipped, "America/Los_Angeles").time, "03:30");
  // 1:30 AM happens twice on November 1, 2026. The first one (PDT) wins.
  assert.equal(new Date(zonedToUtc("2026-11-01", "01:30", "America/Los_Angeles")).toISOString(), "2026-11-01T08:30:00.000Z");
});

test("a shift with a meal break counts the worked minutes", () => {
  const shifts = buildShifts(
    [P("in", "2026-11-18T14:55:00Z"), P("break_start", "2026-11-18T19:30:00Z"), P("break_end", "2026-11-18T20:01:00Z"), P("out", "2026-11-18T23:05:00Z")],
    "UTC",
    DEFAULT_LIMITS,
    NOW
  );
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0]!.breakMinutes, 31);
  assert.equal(shifts[0]!.minutes, 8 * 60 + 10 - 31);
  assert.deepEqual(shifts[0]!.flags, []);
  assert.equal(clockState(shifts).state, "out");
});

test("a shift over 5 hours with no meal break by then gets a flag", () => {
  const late = buildShifts([P("in", "2026-11-18T08:00:00Z"), P("break_start", "2026-11-18T13:30:00Z"), P("break_end", "2026-11-18T14:00:00Z"), P("out", "2026-11-18T16:00:00Z")], "UTC", DEFAULT_LIMITS, NOW);
  assert.deepEqual(late[0]!.flags, ["no_meal"]);
  const none = buildShifts([P("in", "2026-11-18T08:00:00Z"), P("out", "2026-11-18T14:00:00Z")], "UTC", DEFAULT_LIMITS, NOW);
  assert.deepEqual(none[0]!.flags, ["no_meal"]);
  const short = buildShifts([P("in", "2026-11-18T08:00:00Z"), P("out", "2026-11-18T12:30:00Z")], "UTC", DEFAULT_LIMITS, NOW);
  assert.deepEqual(short[0]!.flags, []);
});

test("missed clock-outs and clock-ins are flagged and count no hours", () => {
  const s = buildShifts(
    [P("in", "2026-11-18T07:00:00Z"), P("in", "2026-11-19T07:00:00Z"), P("out", "2026-11-19T15:00:00Z"), P("out", "2026-11-20T15:00:00Z")],
    "UTC",
    DEFAULT_LIMITS,
    NOW
  );
  assert.equal(s.length, 3);
  assert.deepEqual(s[0]!.flags, ["missed_out"]);
  assert.equal(s[0]!.minutes, 0);
  assert.equal(s[1]!.minutes, 8 * 60);
  assert.deepEqual(s[2]!.flags, ["missed_in"]);
  assert.equal(s[2]!.minutes, 0);
});

test("an open shift is on the clock until the missed clock-out limit", () => {
  const open = buildShifts([P("in", "2026-11-23T06:00:00Z"), P("break_start", "2026-11-23T11:30:00Z")], "UTC", DEFAULT_LIMITS, NOW);
  assert.equal(open[0]!.open, true);
  assert.equal(clockState(open).state, "on_break");
  const old = buildShifts([P("in", "2026-11-22T20:00:00Z")], "UTC", DEFAULT_LIMITS, NOW);
  assert.deepEqual(old[0]!.flags, ["missed_out"]);
  assert.equal(clockState(old).state, "out");
});

test("deleted punches do not count, and late and questioned punches flag their shift", () => {
  const s = buildShifts(
    [P("in", "2026-11-18T08:00:00Z", { isLateSync: true }), P("out", "2026-11-18T09:00:00Z", { isDeleted: true }), P("out", "2026-11-18T12:00:00Z", { questioned: true, changed: true })],
    "UTC",
    DEFAULT_LIMITS,
    NOW
  );
  assert.equal(s.length, 1);
  assert.equal(s[0]!.minutes, 240);
  assert.deepEqual(s[0]!.flags, ["late_sync", "questioned"]);
  assert.equal(s[0]!.changed, true);
});

test("a night shift belongs to the day it starts, in the location's time zone", () => {
  const s = buildShifts([P("in", "2026-11-19T06:00:00Z"), P("out", "2026-11-19T14:00:00Z")], "America/Los_Angeles", DEFAULT_LIMITS, NOW);
  assert.equal(s[0]!.date, "2026-11-18");
  assert.equal(s[0]!.minutes, 480);
});

test("day and week totals flag hours over the limits, and count a week once", () => {
  const punches: PunchRow[] = [];
  // Sunday Nov 15 to Friday Nov 20: six 9-hour days with a 30-minute break = 8.5 hours each.
  for (let d = 15; d <= 20; d++) {
    punches.push(P("in", `2026-11-${d}T08:00:00Z`), P("break_start", `2026-11-${d}T12:00:00Z`), P("break_end", `2026-11-${d}T12:30:00Z`), P("out", `2026-11-${d}T17:00:00Z`));
  }
  const shifts = buildShifts(punches, "UTC", DEFAULT_LIMITS, NOW);
  const sheet = personSheet("x", shifts, { start: "2026-11-15", end: "2026-11-28" }, DEFAULT_LIMITS);
  assert.equal(sheet.minutes, 6 * 510);
  assert.equal(sheet.overDayMinutes, 6 * 30);
  assert.equal(sheet.overWeekMinutes, 6 * 510 - 40 * 60);
  assert.ok(sheet.shifts.every((s) => s.flags.includes("over_day")));
  // The week goes over 40 hours on its fifth day (5 x 8.5 = 42.5). Only that shift and the next one get the week flag.
  assert.deepEqual(
    sheet.shifts.map((s) => s.flags.includes("over_week")),
    [false, false, false, false, true, true]
  );
  // A period that ends on Wednesday holds the days, but not the week's Saturday. The next period counts the week.
  const split = personSheet("x", buildShifts(punches, "UTC", DEFAULT_LIMITS, NOW), { start: "2026-11-09", end: "2026-11-18" }, DEFAULT_LIMITS);
  assert.equal(split.minutes, 4 * 510);
  assert.equal(split.overWeekMinutes, 0);
  assert.ok(split.shifts.every((s) => !s.flags.includes("over_week")));
});

test("PINs have 4 to 6 digits", () => {
  assert.equal(pinProblem("1234"), null);
  assert.equal(pinProblem("123456"), null);
  assert.match(pinProblem("123")!, /4 to 6/);
  assert.match(pinProblem("1234567")!, /4 to 6/);
  assert.match(pinProblem("12a4")!, /digits/);
  assert.match(pinProblem(1234)!, /digits/);
});

test("flag limits keep defaults for bad saved values and refuse bad new ones", () => {
  assert.deepEqual(readLimits('{"dayHours": 10, "weekHours": -1, "mealAfterHours": "x"}'), { ...DEFAULT_LIMITS, dayHours: 10 });
  assert.deepEqual(readLimits("not json"), DEFAULT_LIMITS);
  const ok = cleanLimits({ dayHours: 12, missedOutHours: 16 });
  assert.ok("limits" in ok && ok.limits.dayHours === 12 && ok.limits.missedOutHours === 16 && ok.limits.weekHours === 40);
  const bad = cleanLimits({ weekHours: 500 });
  assert.ok("problem" in bad && /1 to 168/.test(bad.problem));
});

test("CSV cells are quoted when needed, and formulas do not run", () => {
  assert.equal(csvCell("Ben T."), "Ben T.");
  assert.equal(csvCell('Ben "B" T.'), '"Ben ""B"" T."');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell(7.5), "7.5");
  assert.equal(csvRow(["a", 1, "b\nc"]), 'a,1,"b\nc"');
});
