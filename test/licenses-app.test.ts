import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHosts, cleanKid, cleanLicenseInput, licensePayload } from "../apps/licenses/src/shared/rules.ts";
import { checkLicense } from "../packages/core/src/server/license.ts";
import { toB64Url } from "../packages/core/src/shared/plans.ts";

const NOW = Date.parse("2026-11-15T20:00:00Z");
const enc = new TextEncoder();

test("key ids are short, lowercase and safe", () => {
  assert.deepEqual(cleanKid(" MG-2026 "), { kid: "mg-2026" });
  assert.ok("problem" in cleanKid("ab"));
  assert.ok("problem" in cleanKid("mg 2026"));
  assert.ok("problem" in cleanKid("-mg"));
});

test("host names are checked and deduplicated", () => {
  assert.deepEqual(cleanHosts("App.GTMmatters.com, app.gtmmatters.com\non.openact.ing"), { hosts: ["app.gtmmatters.com", "on.openact.ing"] });
  assert.deepEqual(cleanHosts(""), { hosts: [] });
  assert.ok("problem" in cleanHosts("https://app.example.com"));
  assert.ok("problem" in cleanHosts("localhost"));
});

test("the issue form needs a licensee, a plan, a use and a last day within 5 years", () => {
  const base = { kid: "mg-2026", licensee: "GTM Matters", plan: "director", use: "grants", expiresAt: "2027-11-15", hosts: "app.gtmmatters.com" };
  const ok = cleanLicenseInput(base, NOW);
  assert.ok(!("problem" in ok));
  assert.equal(ok.issuedAt, "2026-11-15");
  assert.ok("problem" in cleanLicenseInput({ ...base, licensee: " " }, NOW));
  assert.ok("problem" in cleanLicenseInput({ ...base, plan: "gold" }, NOW));
  assert.ok("problem" in cleanLicenseInput({ ...base, use: "all" }, NOW));
  assert.ok("problem" in cleanLicenseInput({ ...base, expiresAt: "2026-11-14" }, NOW));
  assert.ok("problem" in cleanLicenseInput({ ...base, expiresAt: "2031-11-16" }, NOW));
  assert.ok(!("problem" in cleanLicenseInput({ ...base, expiresAt: "2031-11-15" }, NOW)));
});

test("a key signed the way the app signs passes the core check", async () => {
  const input = cleanLicenseInput({ kid: "mg-test", licensee: "GTM Matters", plan: "director", use: "grants", expiresAt: "2027-11-15", hosts: "app.gtmmatters.com" }, NOW);
  assert.ok(!("problem" in input));
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = toB64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const signed = `oa1.${toB64Url(enc.encode(JSON.stringify(licensePayload("lic_test", input))))}`;
  const sig = toB64Url(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, enc.encode(signed))));
  const key = `${signed}.${sig}`;
  const keys = { "mg-test": pub };
  const ok = await checkLicense(key, { host: "app.gtmmatters.com", now: NOW, keys });
  assert.ok(ok.ok && ok.payload.use === "grants" && ok.payload.plan === "director");
  const wrongHost = await checkLicense(key, { host: "evil.example.com", now: NOW, keys });
  assert.ok(!wrongHost.ok);
  const tampered = key.replace(/^oa1\.[^.]+/, `oa1.${toB64Url(enc.encode(JSON.stringify({ ...licensePayload("lic_test", input), plan: "producer" })))}`);
  assert.ok(!(await checkLicense(tampered, { host: "app.gtmmatters.com", now: NOW, keys })).ok);
});
