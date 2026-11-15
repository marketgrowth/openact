import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import {
  formatPrice,
  higherPlan,
  licenseHostOk,
  licenseTime,
  parseLicense,
  planIncludes,
  subscriptionActive
} from "../packages/core/src/shared/plans.ts";
import { checkLicense } from "../packages/core/src/server/license.ts";
import { resolvePlan } from "../packages/core/src/server/plans.ts";
import { subscriptionFields, verifyStripeSignature } from "../packages/core/src/server/stripe.ts";

const DAY = 86400000;

test("Producer includes Director, and free apps need no plan", () => {
  assert.equal(planIncludes("free", undefined), true);
  assert.equal(planIncludes("free", "director"), false);
  assert.equal(planIncludes("director", "director"), true);
  assert.equal(planIncludes("director", "producer"), false);
  assert.equal(planIncludes("producer", "director"), true);
  assert.equal(higherPlan("director", "producer"), "producer");
  assert.equal(higherPlan("free", "director"), "director");
});

test("a subscription keeps its plan while it is active, with a grace period after the paid year", () => {
  const now = Date.parse("2027-01-10T00:00:00Z");
  assert.equal(subscriptionActive("active", "2027-06-01T00:00:00Z", now), true);
  assert.equal(subscriptionActive("past_due", "2027-06-01T00:00:00Z", now), true);
  assert.equal(subscriptionActive("canceled", "2027-06-01T00:00:00Z", now), false);
  assert.equal(subscriptionActive("incomplete", null, now), false);
  assert.equal(subscriptionActive("active", new Date(now - 3 * DAY).toISOString(), now), true);
  assert.equal(subscriptionActive("active", new Date(now - 8 * DAY).toISOString(), now), false);
});

test("the plan is the higher of the subscription and the license", () => {
  const now = Date.parse("2027-01-10T00:00:00Z");
  const row = { plan: "director", status: "active", period_end: "2027-06-01T00:00:00Z" };
  assert.deepEqual(resolvePlan(null, null, now), { plan: "free", source: "free", subscriptionActive: false });
  assert.deepEqual(resolvePlan(row, null, now), { plan: "director", source: "subscription", subscriptionActive: true });
  assert.equal(resolvePlan({ ...row, status: "canceled" }, null, now).plan, "free");
  assert.deepEqual(resolvePlan(row, { ok: true, payload: { plan: "producer" } }, now), {
    plan: "producer",
    source: "license",
    subscriptionActive: true
  });
  assert.equal(resolvePlan(null, { ok: false }, now).plan, "free");
  assert.equal(resolvePlan({ ...row, plan: "gold" }, null, now).plan, "free");
});

test("license dates and hosts", () => {
  const p = { expiresAt: "2027-01-31", hosts: ["app.acme.com"] };
  assert.equal(licenseTime(p, Date.parse("2027-01-31T12:00:00Z")), "valid");
  assert.equal(licenseTime(p, Date.parse("2027-02-10T00:00:00Z")), "grace");
  assert.equal(licenseTime(p, Date.parse("2027-03-01T00:00:00Z")), "expired");
  assert.equal(licenseHostOk(p, "APP.acme.com"), true);
  assert.equal(licenseHostOk(p, "app.acme.com:8787"), true);
  assert.equal(licenseHostOk(p, "other.com"), false);
  assert.equal(licenseHostOk(p, null), false);
  assert.equal(licenseHostOk({}, null), true);
});

test("damaged license keys get a plain message", () => {
  assert.match((parseLicense("hello") as { error: string }).error, /starts with oa1/);
  assert.match((parseLicense("oa1.%%%.abc") as { error: string }).error, /damaged/);
  const payload = Buffer.from(JSON.stringify({ id: "x", kid: "k", licensee: "A", plan: "gold", issuedAt: "2026-01-01", expiresAt: "2027-01-01" })).toString(
    "base64url"
  );
  assert.match((parseLicense(`oa1.${payload}.AA`) as { error: string }).error, /plan/);
});

test("a key from the license tool passes, and a changed key fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openact-license-"));
  try {
    const pem = join(dir, "k.pem");
    const out = execFileSync("node", ["scripts/license.mjs", "keygen", "--kid", "test-1", "--out", pem], { encoding: "utf8" });
    const publicKey = /"test-1": "([^"]+)"/.exec(out)![1]!;
    const issue = (extra: string[] = []) =>
      execFileSync(
        "node",
        ["scripts/license.mjs", "issue", "--key", pem, "--kid", "test-1", "--licensee", "Acme Inc.", "--plan", "director", "--issued", "2026-11-10", "--expires", "2027-11-10", ...extra],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
    const keys = { "test-1": publicKey };
    const now = Date.parse("2027-01-01T00:00:00Z");

    const key = issue();
    const ok = await checkLicense(key, { host: "anything.example", now, keys });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.payload.plan, "director");
    assert.equal(ok.ok && ok.payload.licensee, "Acme Inc.");

    // Another plan in the payload breaks the signature.
    const [pre, body, sig] = key.split(".");
    const changed = Buffer.from(Buffer.from(body!, "base64url").toString().replace('"director"', '"producer"')).toString("base64url");
    const bad = await checkLicense(`${pre}.${changed}.${sig}`, { host: null, now, keys });
    assert.equal(bad.ok, false);
    assert.match(!bad.ok ? bad.error : "", /signature/);

    // An unknown signing key, an expired key and a key for another host fail.
    assert.match(((await checkLicense(key, { host: null, now, keys: {} })) as { error: string }).error, /signing key/);
    assert.match(((await checkLicense(key, { host: null, now: Date.parse("2028-01-01"), keys })) as { error: string }).error, /expired/);
    const hostKey = issue(["--hosts", "app.acme.com"]);
    assert.equal((await checkLicense(hostKey, { host: "app.acme.com", now, keys })).ok, true);
    assert.match(((await checkLicense(hostKey, { host: "evil.example", now, keys })) as { error: string }).error, /works only on/);

    // Inside the grace days, the key still works and says so.
    const grace = await checkLicense(key, { host: null, now: Date.parse("2027-11-15T00:00:00Z"), keys });
    assert.equal(grace.ok && grace.inGrace, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stripe webhook signatures", async () => {
  const secret = "whsec_test";
  const body = '{"type":"customer.subscription.updated"}';
  const t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.equal(await verifyStripeSignature(secret, `t=${t},v1=${sig}`, body, t), true);
  assert.equal(await verifyStripeSignature(secret, `t=${t},v1=deadbeef,v1=${sig}`, body, t + 10), true);
  assert.equal(await verifyStripeSignature(secret, `t=${t},v1=${sig}`, body + " ", t), false);
  assert.equal(await verifyStripeSignature("whsec_other", `t=${t},v1=${sig}`, body, t), false);
  assert.equal(await verifyStripeSignature(secret, `t=${t},v1=${sig}`, body, t + 600), false);
  assert.equal(await verifyStripeSignature(secret, null, body, t), false);
});

test("subscription fields: the price decides the plan", () => {
  const prices = { director: "price_dir", producer: "price_pro" };
  const sub = {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: true,
    metadata: { company_id: "co_1", plan: "director" },
    items: { data: [{ price: { id: "price_pro" }, current_period_end: 1_830_000_000 }] }
  };
  const f = subscriptionFields(sub, prices);
  assert.equal(f.plan, "producer");
  assert.equal(f.companyId, "co_1");
  assert.equal(f.cancelAtPeriodEnd, true);
  assert.equal(f.periodEnd, new Date(1_830_000_000 * 1000).toISOString());
  assert.equal(subscriptionFields({ ...sub, items: { data: [{ price: { id: "price_x" } }] }, current_period_end: 1 }, prices).plan, "director");
  assert.equal(subscriptionFields({ ...sub, metadata: {}, items: { data: [] } }, prices).plan, null);
});

test("prices read like plain text", () => {
  assert.equal(formatPrice({ amount: 120000, currency: "usd", interval: "year" }), "$1,200 a year");
  assert.equal(formatPrice({ amount: 9950, currency: "usd", interval: "year" }), "$99.50 a year");
});
