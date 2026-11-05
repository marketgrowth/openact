import { test } from "node:test";
import assert from "node:assert/strict";
import { dn, ds, fmtRange, isoWeek, workDays } from "../src/client/dates.ts";

test("day numbers round-trip", () => {
  assert.equal(ds(dn("2026-11-05")), "2026-11-05");
  assert.equal(dn("2026-03-09") - dn("2026-03-08"), 1); // no DST shift
});

test("ISO week numbers", () => {
  assert.equal(isoWeek(dn("2026-11-05")), 45);
  assert.equal(isoWeek(dn("2027-01-01")), 53); // 2026 has 53 ISO weeks
  assert.equal(isoWeek(dn("2027-01-04")), 1);
});

test("work days count Monday to Friday", () => {
  assert.equal(workDays("2026-11-02", "2026-11-08"), 5);
  assert.equal(workDays("2026-11-07", "2026-11-08"), 0);
});

test("date ranges read naturally", () => {
  assert.equal(fmtRange("2026-11-09", "2026-11-17"), "Nov 9–17");
  assert.equal(fmtRange("2026-11-30", "2026-12-11"), "Nov 30 – Dec 11");
  assert.equal(fmtRange("2026-11-10", "2026-11-10"), "Nov 10");
  assert.equal(fmtRange(null, null), "No dates");
});
