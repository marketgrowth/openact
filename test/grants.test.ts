import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanGrantEnd, grantActive, utcDay } from "../packages/core/src/shared/grants.ts";

const NOW = Date.parse("2027-03-10T15:00:00Z");

test("a grant with no end day never ends", () => {
  assert.equal(grantActive(null, NOW), true);
  assert.equal(grantActive(undefined, NOW), true);
});

test("a grant works through the whole of its end day, in UTC", () => {
  assert.equal(utcDay(NOW), "2027-03-10");
  assert.equal(grantActive("2027-03-10", NOW), true);
  assert.equal(grantActive("2027-03-10", Date.parse("2027-03-10T23:59:59Z")), true);
  assert.equal(grantActive("2027-03-10", Date.parse("2027-03-11T00:00:00Z")), false);
  assert.equal(grantActive("2027-03-09", NOW), false);
});

test("the end day must be empty, a real date, and not in the past", () => {
  assert.deepEqual(cleanGrantEnd(null, NOW), { endsOn: null });
  assert.deepEqual(cleanGrantEnd("", NOW), { endsOn: null });
  assert.deepEqual(cleanGrantEnd(undefined, NOW), { endsOn: null });
  assert.deepEqual(cleanGrantEnd("2027-03-10", NOW), { endsOn: "2027-03-10" });
  assert.deepEqual(cleanGrantEnd("2027-12-31", NOW), { endsOn: "2027-12-31" });
  assert.ok("problem" in cleanGrantEnd("2027-03-09", NOW));
  assert.ok("problem" in cleanGrantEnd("2027-02-30", NOW));
  assert.ok("problem" in cleanGrantEnd("next week", NOW));
  assert.ok("problem" in cleanGrantEnd(20270310, NOW));
});
