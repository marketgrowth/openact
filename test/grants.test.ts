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

import { grantCeiling, resolvePlan } from "../packages/core/src/server/plans.ts";
import { licenseGivesPlan, parseLicense, toB64Url } from "../packages/core/src/shared/plans.ts";

const lic = (extra: Record<string, unknown>) =>
  `oa1.${toB64Url(new TextEncoder().encode(JSON.stringify({ id: "lic_1", kid: "k", licensee: "MG", plan: "director", issuedAt: "2026-11-15", expiresAt: "2027-11-15", ...extra })))}.AAAA`;

test("a grants key gives no company a plan, but allows grants up to its plan", () => {
  const grantsKey = { ok: true as const, inGrace: false, payload: { id: "l", kid: "k", licensee: "MG", plan: "director" as const, issuedAt: "2026-11-15", expiresAt: "2027-11-15", use: "grants" as const } };
  const planKey = { ...grantsKey, payload: { ...grantsKey.payload, use: undefined } };
  assert.equal(resolvePlan(null, grantsKey, NOW).plan, "free");
  assert.equal(resolvePlan(null, planKey, NOW).plan, "director");
  assert.equal(grantCeiling(grantsKey), "director");
  assert.equal(grantCeiling(planKey), "director");
  assert.equal(licenseGivesPlan(grantsKey.payload), false);
  assert.equal(licenseGivesPlan(planKey.payload), true);
});

test("without a working license key, nothing can be granted", () => {
  assert.equal(grantCeiling(null), "free");
  assert.equal(grantCeiling({ ok: false, error: "expired" }), "free");
});

test("a license key reads its use, and refuses a use it does not know", () => {
  const ok = parseLicense(lic({ use: "grants" }));
  assert.ok("payload" in ok && ok.payload.use === "grants");
  assert.ok("payload" in parseLicense(lic({})));
  assert.ok("error" in parseLicense(lic({ use: "everything" })));
});
