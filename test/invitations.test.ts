import { test } from "node:test";
import assert from "node:assert/strict";
import { companyInviteEmail } from "../packages/core/src/server/email.ts";
import { companyAllowsSignup } from "../packages/core/src/server/companies.ts";
import { INVITE_DAILY_LIMIT } from "../packages/core/src/shared/invitations.ts";
import { makeDeploy } from "./harness/deploy.ts";

/*
 * Invitations (docs/invitations.md): a person joins only when they accept.
 * The tests call the real routes on an in-memory deploy.
 */

async function company(d: ReturnType<typeof makeDeploy>, name = "Acme") {
  const owner = d.person(`owner@${name.toLowerCase()}.test`);
  const r = await d.call(owner, "POST", "/api/companies", { name });
  assert.equal(r.status, 201, r.text);
  const companyId = d.one<{ id: string }>("SELECT company_id AS id FROM company_members WHERE user_id = ?", owner.id).id;
  return { owner, companyId };
}
const role = (d: ReturnType<typeof makeDeploy>, companyId: string, userId: string) =>
  d.one<{ role: string } | undefined>("SELECT role FROM company_members WHERE company_id = ? AND user_id = ?", companyId, userId)?.role;

test("the email subject is fixed text and the company name stays in the body", () => {
  const d = makeDeploy();
  const mail = companyInviteEmail(d.env as never, { to: "a@b.test", companyName: "Free Prizes Inc", inviterName: "Eve", role: "Member", url: "https://x.test", siteName: "OpenAct" });
  assert.equal(mail.subject, "You have an invitation on OpenAct");
  assert.match(mail.text, /Free Prizes Inc/);
});

test("an invited account does not join until it accepts, and a known and an unknown email get the same reply", async () => {
  const d = makeDeploy();
  const { owner, companyId } = await company(d);
  const known = d.person("ana@else.test");
  const a = await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: known.email, role: "member" });
  const b = await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: "new@else.test", role: "member" });
  assert.equal(a.status, 201);
  assert.deepEqual(a.json, { ok: true });
  assert.deepEqual(b.json, a.json);
  assert.equal(role(d, companyId, known.id), undefined, "not a member yet");

  const list = (await d.call(known, "GET", "/api/invitations")).json!.invitations as Array<{ id: string; companyName: string; role: string; level: string }>;
  assert.equal(list.length, 1);
  assert.deepEqual({ name: list[0]!.companyName, role: list[0]!.role, level: list[0]!.level }, { name: "Acme", role: "member", level: "company" });

  assert.equal((await d.call(known, "POST", `/api/invitations/${list[0]!.id}/accept`)).status, 200);
  assert.equal(role(d, companyId, known.id), "member");
  assert.equal(d.all("SELECT 1 FROM company_invitations WHERE email = ?", known.email).length, 0);
});

test("declining removes the invitation, and nobody else can answer it", async () => {
  const d = makeDeploy();
  const { owner, companyId } = await company(d);
  const ana = d.person("ana@else.test");
  const eve = d.person("eve@else.test");
  await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: ana.email });
  const id = d.one<{ id: string }>("SELECT id FROM company_invitations WHERE email = ?", ana.email).id;
  assert.equal((await d.call(eve, "POST", `/api/invitations/${id}/accept`)).status, 404);
  assert.equal((await d.call(eve, "POST", `/api/invitations/${id}/decline`)).status, 404);
  assert.equal((await d.call(ana, "POST", `/api/invitations/${id}/decline`)).status, 200);
  assert.equal(role(d, companyId, ana.id), undefined);
  assert.equal((await d.call(ana, "POST", `/api/invitations/${id}/accept`)).status, 404);
});

test("an expired invitation cannot be accepted and is not listed", async () => {
  const d = makeDeploy();
  const { owner, companyId } = await company(d);
  const ana = d.person("ana@else.test");
  await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: ana.email });
  d.db.prepare("UPDATE company_invitations SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal(((await d.call(ana, "GET", "/api/invitations")).json!.invitations as unknown[]).length, 0);
  const id = d.one<{ id: string }>("SELECT id FROM company_invitations").id;
  assert.equal((await d.call(ana, "POST", `/api/invitations/${id}/accept`)).status, 410);
  assert.equal(role(d, companyId, ana.id), undefined);
});

test("a guest who accepts becomes a member, and a member cannot be invited again", async () => {
  const d = makeDeploy();
  const { owner, companyId } = await company(d);
  const g = d.person("guest@else.test");
  d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'guest', ?)").run(companyId, g.id, new Date().toISOString());
  await d.join(owner, companyId, g, "member");
  assert.equal(role(d, companyId, g.id), "member");
  // A person who is already a member cannot be invited again.
  assert.equal((await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: g.email })).status, 409);
});

test("an invitation can name a workspace of the same company only", async () => {
  const d = makeDeploy();
  const { owner, companyId } = await company(d, "Acme");
  const other = await company(d, "Beta");
  const wsOther = d.one<{ id: string }>("SELECT id FROM workspaces WHERE company_id = ?", other.companyId).id;
  const wsOwn = d.one<{ id: string }>("SELECT id FROM workspaces WHERE company_id = ?", companyId).id;
  assert.equal((await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: "a@x.test", workspaceId: wsOther })).status, 400);
  assert.equal((await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: "a@x.test", workspaceId: wsOwn })).status, 201);
  assert.equal(d.one<{ workspace_id: string }>("SELECT workspace_id FROM company_invitations WHERE email = 'a@x.test'").workspace_id, wsOwn);
});

test("a company sends at most 50 invitations a day, even when people accept", async () => {
  const d = makeDeploy();
  const { owner, companyId } = await company(d);
  for (let i = 0; i < INVITE_DAILY_LIMIT; i++) {
    const r = await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: `p${i}@bulk.test` });
    assert.equal(r.status, 201, `${i}: ${r.text}`);
  }
  assert.equal((await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: "one-more@bulk.test" })).status, 429);
  d.db.prepare("DELETE FROM company_invitations").run();
  assert.equal((await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: "after-delete@bulk.test" })).status, 429, "deleting the rows does not reset the count");
});

test("a site invitation makes the company, and the invitee becomes its first owner and skips onboarding", async () => {
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "root@deploy.test" });
  const root = d.person("root@deploy.test");
  const nina = d.person("nina@client.test");
  const body = { legalName: "Client Co, Inc.", entityType: "corporation", email: nina.email };
  assert.equal((await d.call(nina, "POST", "/api/site/companies/invite", body)).status, 403, "only the super admin");
  assert.equal((await d.call(root, "POST", "/api/site/companies/invite", { ...body, entityType: "club" })).status, 400);
  const r = await d.call(root, "POST", "/api/site/companies/invite", body);
  assert.equal(r.status, 201, r.text);
  const co = d.one<{ id: string; name: string; legal_name: string; entity_type: string }>("SELECT id, name, legal_name, entity_type FROM companies");
  assert.deepEqual({ ...co, id: "x" }, { id: "x", name: "Client Co, Inc.", legal_name: "Client Co, Inc.", entity_type: "corporation" });
  assert.equal(d.all("SELECT 1 FROM company_members WHERE company_id = ?", co.id).length, 0, "no people until the invitee accepts");
  assert.equal(d.one<{ name: string }>("SELECT name FROM workspaces WHERE company_id = ?", co.id).name, "Client Co, Inc.");

  assert.deepEqual((await d.call(nina, "GET", "/api/onboarding")).json, { required: false }, "an invitee answers the invitation, not onboarding");
  const inv = d.one<{ id: string; role: string; level: string }>("SELECT id, role, level FROM company_invitations WHERE company_id = ?", co.id);
  assert.deepEqual({ role: inv.role, level: inv.level }, { role: "owner", level: "site" });
  assert.equal((await d.call(nina, "POST", `/api/invitations/${inv.id}/accept`)).status, 200);
  assert.equal(role(d, co.id, nina.id), "owner");
  assert.deepEqual((await d.call(nina, "GET", "/api/onboarding")).json, { required: false });
});

test("declining a site invitation removes the empty company", async () => {
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "root@deploy.test" });
  const root = d.person("root@deploy.test");
  const nina = d.person("nina@client.test");
  await d.call(root, "POST", "/api/site/companies/invite", { legalName: "Client Co", entityType: "llc", email: nina.email });
  const id = d.one<{ id: string }>("SELECT id FROM company_invitations").id;
  assert.equal((await d.call(nina, "POST", `/api/invitations/${id}/decline`)).status, 200);
  assert.equal(d.all("SELECT 1 FROM companies").length, 0);
  assert.deepEqual((await d.call(nina, "GET", "/api/onboarding")).json, { required: true });
});

test("a workspace-level invitation does not open sign-up, and a company one does", async () => {
  const d = makeDeploy();
  const { companyId, owner } = await company(d);
  const ws = d.one<{ id: string }>("SELECT id FROM workspaces WHERE company_id = ?", companyId).id;
  const iso = new Date().toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  const add = (email: string, level: string, exp = future) =>
    d.db
      .prepare("INSERT INTO company_invitations (id, company_id, email, role, level, workspace_id, invited_by, created_at, expires_at) VALUES (?, ?, ?, 'member', ?, ?, ?, ?, ?)")
      .run(email, companyId, email, level, ws, owner.id, iso, exp);
  add("w@x.test", "workspace");
  add("c@x.test", "company");
  add("old@x.test", "company", "2020-01-01T00:00:00.000Z");
  assert.equal(await companyAllowsSignup(d.env as never, "w@x.test"), false);
  assert.equal(await companyAllowsSignup(d.env as never, "c@x.test"), true);
  assert.equal(await companyAllowsSignup(d.env as never, "old@x.test"), false);
});
