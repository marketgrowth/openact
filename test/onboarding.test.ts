import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTITY_TYPES, ENTITY_TYPE_LABELS } from "../packages/core/src/shared/onboarding.ts";
import { makeDeploy } from "./harness/deploy.ts";

/*
 * Onboarding (docs/onboarding.md): a new person with no company sets one up.
 * The tests call the real routes on an in-memory deploy.
 */

const answers = { legalName: "Harbor & Pine, LLC", entityType: "llc", brand: "Harbor Coffee", brandKind: "brand" };

test("every company type has a label", () => {
  assert.deepEqual([...ENTITY_TYPES], ["corporation", "llc", "sole_proprietorship", "partnership", "nonprofit", "other"]);
  for (const t of ENTITY_TYPES) assert.ok(ENTITY_TYPE_LABELS[t]);
});

test("a new person with no company must set one up, and onboarding makes it", async () => {
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "root@deploy.test" });
  const maya = d.person("maya@harborpine.com");
  assert.deepEqual((await d.call(maya, "GET", "/api/onboarding")).json, { required: true });

  const r = await d.call(maya, "POST", "/api/onboarding", answers);
  assert.equal(r.status, 201);
  const co = d.one<{ id: string; name: string; legal_name: string; entity_type: string }>("SELECT id, name, legal_name, entity_type FROM companies");
  assert.equal(co.name, "Harbor & Pine, LLC");
  assert.equal(co.legal_name, "Harbor & Pine, LLC");
  assert.equal(co.entity_type, "llc");
  assert.equal(d.one<{ role: string }>("SELECT role FROM company_members WHERE company_id = ? AND user_id = ?", co.id, maya.id).role, "owner");
  const wsRows = d.all<{ name: string; kind: string; is_default: number }>("SELECT name, kind, is_default FROM workspaces WHERE company_id = ?", co.id);
  assert.equal(wsRows.length, 1);
  assert.deepEqual({ ...wsRows[0] }, { name: "Harbor Coffee", kind: "brand", is_default: 1 });
  assert.equal(d.one<{ current_company_id: string }>("SELECT current_company_id FROM users WHERE id = ?", maya.id).current_company_id, co.id);

  assert.deepEqual((await d.call(maya, "GET", "/api/onboarding")).json, { required: false });
  assert.equal((await d.call(maya, "POST", "/api/onboarding", answers)).status, 409, "a second run is refused");
});

test("a business unit becomes the first workspace with that kind", async () => {
  const d = makeDeploy();
  const p = d.person("a@x.com");
  assert.equal((await d.call(p, "POST", "/api/onboarding", { ...answers, brandKind: "business_unit", entityType: "nonprofit" })).status, 201);
  assert.equal(d.one<{ kind: string }>("SELECT kind FROM workspaces").kind, "business_unit");
  assert.equal(d.one<{ entity_type: string }>("SELECT entity_type FROM companies").entity_type, "nonprofit");
});

test("onboarding checks every answer", async () => {
  const d = makeDeploy();
  const p = d.person("a@x.com");
  for (const bad of [
    { ...answers, legalName: "" },
    { ...answers, legalName: "x".repeat(81) },
    { ...answers, entityType: "trust" },
    { ...answers, brand: "  " },
    { ...answers, brandKind: "region" }
  ])
    assert.equal((await d.call(p, "POST", "/api/onboarding", bad)).status, 400, JSON.stringify(bad));
  assert.equal(d.all("SELECT id FROM companies").length, 0);
});

test("a person who joined a company never needs onboarding", async () => {
  const d = makeDeploy();
  const owner = d.person("o@x.com");
  await d.call(owner, "POST", "/api/onboarding", answers);
  const co = d.one<{ id: string }>("SELECT id FROM companies");
  const guest = d.person("g@x.com");
  d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'guest', ?)").run(co.id, guest.id, new Date().toISOString());
  assert.deepEqual((await d.call(guest, "GET", "/api/onboarding")).json, { required: false });
  assert.equal((await d.call(guest, "POST", "/api/onboarding", answers)).status, 409);
});

test("only a super admin turns onboarding off, and then nobody is asked", async () => {
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "root@deploy.test" });
  const root = d.person("root@deploy.test");
  const other = d.person("other@x.com");
  assert.equal((await d.call(other, "PATCH", "/api/site/onboarding", { enabled: false })).status, 403);
  assert.equal((await d.call(root, "GET", "/api/site")).json!.onboardingEnabled, true, "on by default, also for the super admin");
  assert.deepEqual((await d.call(root, "GET", "/api/onboarding")).json, { required: true });

  assert.equal((await d.call(root, "PATCH", "/api/site/onboarding", { enabled: false })).status, 200);
  assert.deepEqual((await d.call(other, "GET", "/api/onboarding")).json, { required: false });
  assert.equal((await d.call(other, "POST", "/api/onboarding", answers)).status, 400);
  assert.equal((await d.call(other, "POST", "/api/companies", { name: "Mine" })).status, 201, "New company still works");

  assert.equal((await d.call(root, "PATCH", "/api/site/onboarding", { enabled: true })).status, 200);
  assert.equal((await d.call(root, "PATCH", "/api/site/onboarding", { enabled: "yes" })).status, 400);
  assert.deepEqual((await d.call(root, "GET", "/api/onboarding")).json, { required: true });
});

test("company settings edit the legal name and type", async () => {
  const d = makeDeploy();
  const p = d.person("a@x.com");
  await d.call(p, "POST", "/api/onboarding", answers);
  const id = d.one<{ id: string }>("SELECT id FROM companies").id;
  assert.equal((await d.call(p, "PATCH", `/api/companies/${id}`, { legalName: "Harbor and Pine Holdings, Inc.", entityType: "corporation" })).status, 200);
  const detail = (await d.call(p, "GET", `/api/companies/${id}`)).json!;
  assert.equal(detail.legalName, "Harbor and Pine Holdings, Inc.");
  assert.equal(detail.entityType, "corporation");
  assert.equal(detail.name, "Harbor & Pine, LLC", "the display name does not change");
  assert.equal((await d.call(p, "PATCH", `/api/companies/${id}`, { entityType: "trust" })).status, 400);
});
