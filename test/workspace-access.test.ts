import { test } from "node:test";
import assert from "node:assert/strict";
import { joinCompaniesAtSignIn } from "../packages/core/src/server/companies.ts";
import { makeDeploy } from "./harness/deploy.ts";

/*
 * Workspace access (docs/workspaces.md): a member works only in the workspaces they are in.
 * The tests call the real routes on an in-memory deploy.
 */

async function setup() {
  const d = makeDeploy();
  const owner = d.person("owner@acme.test");
  assert.equal((await d.call(owner, "POST", "/api/companies", { name: "Acme" })).status, 201);
  const companyId = d.one<{ company_id: string }>("SELECT company_id FROM company_members WHERE user_id = ?", owner.id).company_id;
  const a = d.one<{ id: string }>("SELECT id FROM workspaces WHERE company_id = ?", companyId).id; // the default workspace
  const rb = await d.call(owner, "POST", `/api/companies/${companyId}/workspaces`, { name: "Brand B" });
  assert.equal(rb.status, 201, rb.text);
  const b = rb.json!.workspace.id as string;
  const ana = d.person("ana@else.test");
  await d.join(owner, companyId, ana); // ana starts in the default workspace A
  return { d, owner, ana, companyId, a, b };
}
const inWs = (d: ReturnType<typeof makeDeploy>, ws: string, userId: string) =>
  d.all("SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?", ws, userId).length === 1;

test("a member lists and opens only the workspaces they are in", async () => {
  const { d, owner, ana, companyId, a, b } = await setup();
  const names = async (p: typeof ana) => ((await d.call(p, "GET", `/api/companies/${companyId}/workspaces`)).json!.workspaces as Array<{ id: string }>).map((w) => w.id);
  assert.deepEqual(await names(ana), [a]);
  assert.equal((await d.call(ana, "POST", `/api/companies/${companyId}/workspaces/${b}/switch`)).status, 404);
  assert.equal((await d.call(ana, "POST", `/api/companies/${companyId}/workspaces/${a}/switch`)).status, 200);
  assert.equal((await names(owner)).length, 2, "an owner sees every workspace");
  const list = (await d.call(ana, "GET", "/api/companies")).json as { companies?: Array<{ workspaces: unknown[] }> } | Array<{ workspaces: unknown[] }>;
  const companies = Array.isArray(list) ? list : list.companies!;
  assert.equal(companies[0]!.workspaces.length, 1, "the company list shows only the member's workspaces");
});

test("a member cannot list or open a project in a workspace they are not in", async () => {
  const { d, owner, ana, companyId, a, b } = await setup();
  const mk = async (name: string, workspaceId: string) => {
    const r = await d.call(owner, "POST", "/api/projects", { name, companyId, workspaceId });
    assert.equal(r.status, 201, r.text);
    return (r.json!.project?.id ?? r.json!.id) as string;
  };
  const pa = await mk("In A", a);
  const pb = await mk("In B", b);
  const ids = async (ws: string) => ((await d.call(ana, "GET", `/api/projects?company=${companyId}&workspace=${ws}`)).json!.projects as Array<{ id: string }>).map((p) => p.id);
  assert.deepEqual(await ids(a), [pa]);
  assert.equal((await d.call(ana, "GET", `/api/projects?company=${companyId}&workspace=${b}`)).status, 404);
  assert.equal((await d.call(ana, "GET", `/api/projects/${pa}`)).status, 200);
  assert.equal((await d.call(ana, "GET", `/api/projects/${pb}`)).status, 403, "opening it by link does not work");
  assert.equal((await d.call(owner, "GET", `/api/projects/${pb}`)).status, 200);
  // A member cannot move a project into a workspace they are not in.
  assert.equal((await d.call(owner, "POST", `/api/projects/${pa}/members`, { email: ana.email, role: "owner" })).status < 300, true);
  assert.equal((await d.call(ana, "PATCH", `/api/projects/${pa}`, { workspaceId: b })).status, 400);
});

test("an invitation to a workspace starts the person there, and nowhere else", async () => {
  const { d, owner, companyId, b } = await setup();
  const eve = d.person("eve@else.test");
  assert.equal((await d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: eve.email, workspaceId: b })).status, 201);
  const inv = d.one<{ id: string }>("SELECT id FROM company_invitations WHERE email = ?", eve.email).id;
  assert.equal((await d.call(eve, "POST", `/api/invitations/${inv}/accept`)).status, 200);
  const rows = d.all<{ workspace_id: string }>("SELECT workspace_id FROM workspace_members WHERE user_id = ?", eve.id);
  assert.deepEqual(rows.map((r) => r.workspace_id), [b]);
});

test("a person in a workspace invites by email, always as a member, into that workspace only", async () => {
  const { d, owner, ana, companyId, a, b } = await setup();
  const known = d.person("kim@else.test");
  await d.join(owner, companyId, known);
  d.db.prepare("DELETE FROM workspace_members WHERE user_id = ?").run(known.id);
  const url = (ws: string, p: string) => `/api/companies/${companyId}/workspaces/${ws}/${p}`;

  // A person who is in the company joins the workspace at once.
  const r1 = await d.call(ana, "POST", url(a, "invite"), { email: known.email });
  assert.equal(r1.status, 201);
  assert.equal(inWs(d, a, known.id), true);
  // A new email gets a member invitation for this workspace. The reply is the same.
  const r2 = await d.call(ana, "POST", url(a, "invite"), { email: "new@else.test" });
  assert.deepEqual(r2.json, r1.json);
  const inv = d.one<{ role: string; level: string; workspace_id: string }>("SELECT role, level, workspace_id FROM company_invitations WHERE email = 'new@else.test'");
  assert.deepEqual({ ...inv }, { role: "member", level: "workspace", workspace_id: a });
  // Ana is not in workspace B, so it looks like it does not exist.
  assert.equal((await d.call(ana, "POST", url(b, "invite"), { email: "x@else.test" })).status, 404);
  assert.equal((await d.call(ana, "GET", url(b, "members"))).status, 404);
  // An owner invite from the workspace is a company level invitation.
  await d.call(owner, "POST", url(b, "invite"), { email: "boss@else.test" });
  assert.equal(d.one<{ level: string }>("SELECT level FROM company_invitations WHERE email = 'boss@else.test'").level, "company");
});

test("a company can turn off member invites", async () => {
  const { d, owner, ana, companyId, a } = await setup();
  assert.equal((await d.call(owner, "PATCH", `/api/companies/${companyId}`, { memberInvites: false })).status, 200);
  assert.equal((await d.call(ana, "POST", `/api/companies/${companyId}/workspaces/${a}/invite`, { email: "z@else.test" })).status, 403);
  assert.equal((await d.call(owner, "POST", `/api/companies/${companyId}/workspaces/${a}/invite`, { email: "z@else.test" })).status, 201, "owners still invite");
  assert.equal((await d.call(ana, "POST", `/api/companies/${companyId}/members`, { email: "y@else.test" })).status, 403, "a member never invites at company level");
});

test("owners and admins add and remove workspace people, and leaving the company removes the rows", async () => {
  const { d, owner, ana, companyId, a, b } = await setup();
  const url = `/api/companies/${companyId}/workspaces/${b}/members`;
  assert.equal((await d.call(ana, "POST", url, { userId: ana.id })).status, 403);
  assert.equal((await d.call(owner, "POST", url, { userId: owner.id })).status, 400, "owners are in every workspace");
  assert.equal((await d.call(owner, "POST", url, { userId: ana.id })).status, 201);
  assert.equal(inWs(d, b, ana.id), true);
  assert.equal((await d.call(owner, "DELETE", `${url}/${ana.id}`)).status, 200);
  assert.equal(inWs(d, b, ana.id), false);
  assert.equal((await d.call(owner, "DELETE", `/api/companies/${companyId}/members/${ana.id}`)).status, 200);
  assert.equal(d.all("SELECT 1 FROM workspace_members WHERE user_id = ?", ana.id).length, 0);
  assert.equal(inWs(d, a, ana.id), false);
});

test("a person who becomes a member starts in the default workspace", async () => {
  const { d, owner, companyId, a } = await setup();
  const boss = d.person("boss@else.test");
  await d.join(owner, companyId, boss, "admin");
  assert.equal(d.all("SELECT 1 FROM workspace_members WHERE user_id = ?", boss.id).length, 0, "admins need no rows");
  assert.equal((await d.call(owner, "PATCH", `/api/companies/${companyId}/members/${boss.id}`, { role: "member" })).status, 200);
  assert.equal(inWs(d, a, boss.id), true);
});

test("joining by email domain starts in the default workspace once, and a removal sticks", async () => {
  const { d, owner, companyId, a } = await setup();
  d.db.prepare("UPDATE companies SET email_domain = 'acme.test' WHERE id = ?").run(companyId);
  const sam = d.person("sam@acme.test");
  await joinCompaniesAtSignIn(d.env as never, { id: sam.id, email: sam.email, name: sam.name });
  assert.equal(inWs(d, a, sam.id), true);
  await d.call(owner, "DELETE", `/api/companies/${companyId}/workspaces/${a}/members/${sam.id}`);
  await joinCompaniesAtSignIn(d.env as never, { id: sam.id, email: sam.email, name: sam.name });
  assert.equal(inWs(d, a, sam.id), false, "signing in again does not add the person back");
});
