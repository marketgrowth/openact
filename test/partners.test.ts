import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHost, cleanPartnerName } from "../packages/core/src/shared/partners.ts";
import { senderFor } from "../packages/core/src/server/email.ts";
import { forgetPartners } from "../packages/core/src/server/partners.ts";
import { forgetPartnerLinks } from "../packages/core/src/server/partner-link.ts";
import { aiOverride, companyAiChoice } from "../packages/core/src/server/company-ai.ts";
import { companyServiceKey } from "../packages/core/src/server/company-keys.ts";
import { companyAppState } from "../packages/core/src/server/permissions.ts";
import { sealKey } from "../packages/core/src/server/secret-box.ts";
import { SESSION_COOKIE } from "../packages/core/src/server/auth.ts";
import { makeDeploy, type Person } from "./harness/deploy.ts";

/*
 * Partner domains (docs/partners.md): a host name that shows a partner company's name and logo,
 * and counts the companies that the partner makes there as its client companies.
 */

test("host names are cleaned to a bare lowercase host", () => {
  assert.deepEqual(cleanHost("App.Brightline.com"), { host: "app.brightline.com" });
  assert.deepEqual(cleanHost("https://app.brightline.com/"), { host: "app.brightline.com" });
  assert.deepEqual(cleanHost(" app.brightline.com:443 "), { host: "app.brightline.com" });
  assert.deepEqual(cleanHost("app.brightline.com."), { host: "app.brightline.com" });
  for (const bad of ["", "   ", "localhost", "app.brightline.com/login", "https://u:p@app.brightline.com", "10.0.0.1", "ftp://app.brightline.com", "bad_host.com", 42, null])
    assert.ok("problem" in cleanHost(bad), `refused: ${String(bad)}`);
});

test("the partner name is one clean line, and empty means the company name", () => {
  assert.deepEqual(cleanPartnerName("  Brightline \n Marketing "), { name: "Brightline Marketing" });
  assert.deepEqual(cleanPartnerName(undefined), { name: "" });
  assert.ok("problem" in cleanPartnerName("x".repeat(41)));
  assert.ok("problem" in cleanPartnerName(7));
});

test("on a partner host, emails keep the verified address and show the partner's name", () => {
  assert.equal(senderFor({ EMAIL_FROM: "A/GEO <no-reply@ageoresearch.com>" }), "A/GEO <no-reply@ageoresearch.com>");
  assert.equal(senderFor({ EMAIL_FROM: "A/GEO <no-reply@ageoresearch.com>", PARTNER_NAME: "Brightline" }), '"Brightline" <no-reply@ageoresearch.com>');
  assert.equal(senderFor({ EMAIL_FROM: "no-reply@ageoresearch.com", PARTNER_NAME: 'Bad "<Name>"' }), '"Bad Name" <no-reply@ageoresearch.com>');
});

const PARTNER_HOST = "app.brightline.test";

/** A deploy with a super admin, a partner company with its owner, and a partner domain. */
async function setup() {
  forgetPartners();
  forgetPartnerLinks();
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "admin@deploy.test" });
  const admin = d.person("admin@deploy.test");
  const agency = d.person("owner@brightline.test", "Bri Owner");
  const made = await d.call(agency, "POST", "/api/companies", { name: "Brightline Marketing" });
  const partnerId = (made.json!.company as { id: string }).id;
  const added = await d.call(admin, "POST", "/api/site/partners", { host: "https://App.Brightline.test/", companyId: partnerId, name: "Brightline" });
  assert.equal(added.status, 201, added.text);
  assert.equal((added.json as { host: string }).host, PARTNER_HOST);

  /** Calls a route on the partner host. */
  async function onHost(who: Person | null, method: string, path: string, body?: unknown) {
    const origin = `https://${PARTNER_HOST}`;
    const h = new Headers({ origin });
    if (who) h.set("cookie", `${SESSION_COOKIE}=${who.token}`);
    if (body !== undefined) h.set("content-type", "application/json");
    const res = await d.app.fetch(new Request(origin + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), d.env as never, {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {}
    } as never);
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, text, json };
  }
  return { d, admin, agency, partnerId, onHost };
}

test("a partner host shows the partner's name, and the site's own host does not", async () => {
  const { d, onHost } = await setup();
  const there = await onHost(null, "GET", "/api/config");
  assert.equal(there.json!.appName, "Brightline");
  assert.equal((there.json!.partner as { name: string }).name, "Brightline");
  assert.equal(there.json!.issuesUrl, null);
  assert.equal((there.json!.signIn as { heading: string }).heading, "Sign in to Brightline.");
  const home = await d.call(null, "GET", "/api/config");
  assert.equal(home.json!.appName, "Test deploy");
  assert.equal(home.json!.partner, null);
});

test("companies that the partner's owners make on their host are its clients; other companies are not", async () => {
  const { d, agency, partnerId, onHost } = await setup();
  const client = await onHost(agency, "POST", "/api/companies", { name: "Riverside Plumbing" });
  assert.equal(client.status, 201, client.text);
  const clientId = (client.json!.company as { id: string }).id;
  assert.equal(d.one<{ partner_id: string | null }>("SELECT partner_id FROM companies WHERE id = ?", clientId).partner_id, partnerId);

  // The same owner on the site's own host makes an ordinary company.
  const own = await d.call(agency, "POST", "/api/companies", { name: "Side project" });
  assert.equal(d.one<{ partner_id: string | null }>("SELECT partner_id FROM companies WHERE id = ?", (own.json!.company as { id: string }).id).partner_id, null);

  // A stranger on the partner host makes an ordinary company too.
  const stranger = d.person("someone@else.test");
  const theirs = await onHost(stranger, "POST", "/api/companies", { name: "Not a client" });
  assert.equal(d.one<{ partner_id: string | null }>("SELECT partner_id FROM companies WHERE id = ?", (theirs.json!.company as { id: string }).id).partner_id, null);

  const list = await onHost(agency, "GET", `/api/companies/${partnerId}/clients`);
  assert.equal(list.status, 200, list.text);
  assert.deepEqual((list.json!.hosts as string[]), [PARTNER_HOST]);
  assert.deepEqual((list.json!.clients as Array<{ name: string }>).map((k) => k.name), ["Riverside Plumbing"]);

  // Only the partner's owners and admins see its clients.
  const theirList = await onHost(stranger, "GET", `/api/companies/${partnerId}/clients`);
  assert.equal(theirList.status, 404);
});

test("the sign-in email on a partner host names the partner and links to its host", async () => {
  const { d, onHost } = await setup();
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const r = await onHost(null, "POST", "/api/auth/request-code", { email: "client@riverside.test" });
    assert.equal(r.status, 200, r.text);
  } finally {
    console.log = log;
  }
  const mail = lines.join("\n");
  assert.match(mail, /is your Brightline sign-in code/);
  assert.doesNotMatch(mail, /Test deploy/);
  // A request on the site's own host still names the site.
  const home: string[] = [];
  console.log = (...a: unknown[]) => void home.push(a.join(" "));
  try {
    await d.call(null, "POST", "/api/auth/request-code", { email: "client2@riverside.test" });
  } finally {
    console.log = log;
  }
  assert.match(home.join("\n"), /is your Test deploy sign-in code/);
});

test("only super admins manage partner domains, and a host belongs to one partner", async () => {
  const { d, admin, agency, partnerId } = await setup();
  const denied = await d.call(agency, "GET", "/api/site/partners");
  assert.equal(denied.status, 403);
  const list = await d.call(admin, "GET", "/api/site/partners");
  assert.equal((list.json!.domains as unknown[]).length, 1);
  const again = await d.call(admin, "POST", "/api/site/partners", { host: PARTNER_HOST, companyId: partnerId });
  assert.equal(again.status, 409);
  const own = await d.call(admin, "POST", "/api/site/partners", { host: "deploy.test", companyId: partnerId });
  assert.equal(own.status, 400);
  const renamed = await d.call(admin, "PATCH", `/api/site/partners/${PARTNER_HOST}`, { name: "" });
  assert.equal(renamed.json!.name, null);
  const gone = await d.call(admin, "DELETE", `/api/site/partners/${PARTNER_HOST}`);
  assert.equal(gone.status, 200);
  assert.equal(d.all("SELECT host FROM partner_domains").length, 0);
});

test("an app lists only the partner's clients that the person is still in", async () => {
  const { d, agency, partnerId, onHost } = await setup();
  const { partnerClientCompanies } = await import("../packages/core/src/server/partners.ts");
  const a = await onHost(agency, "POST", "/api/companies", { name: "Alder Dental" });
  const b = await onHost(agency, "POST", "/api/companies", { name: "Birch Law" });
  const aId = (a.json!.company as { id: string }).id;
  assert.deepEqual((await partnerClientCompanies(d.env as never, partnerId, agency.id)).map((k) => k.name), ["Alder Dental", "Birch Law"]);
  // The client removes the agency: Alder Dental drops off the list.
  d.db.prepare("DELETE FROM company_members WHERE company_id = ? AND user_id = ?").run(aId, agency.id);
  assert.deepEqual((await partnerClientCompanies(d.env as never, partnerId, agency.id)).map((k) => k.name), ["Birch Law"]);
  // Someone else sees none of them.
  const other = d.person("other@else.test");
  assert.deepEqual(await partnerClientCompanies(d.env as never, partnerId, other.id), []);
  void b;
});

/* Partner controls: own AI keys, pause, owner invitations and handover. */

/** A partner with one client company, made on the partner host, with the client invited as a member. */
async function withClient() {
  const s = await setup();
  const made = await s.onHost(s.agency, "POST", "/api/companies", { name: "Alder Dental" });
  const clientId = (made.json!.company as { id: string }).id;
  const client = s.d.person("dr@alder.test", "Dr Alder");
  s.d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)").run(clientId, client.id, new Date().toISOString());
  forgetPartnerLinks();
  return { ...s, clientId, client };
}

/** Saves a company AI row the way PUT /api/companies/:id/ai does, without the live key test. */
async function saveCompanyAi(d: ReturnType<typeof makeDeploy>, companyId: string, key: string) {
  const sealed = await sealKey(d.env.AUTH_SECRET, companyId, key);
  d.db
    .prepare("INSERT INTO company_ai (company_id, provider, model, key_cipher, key_hint, updated_at) VALUES (?, 'anthropic', 'claude-haiku-5-5', ?, ?, ?)")
    .run(companyId, sealed, key.slice(-4), new Date().toISOString());
  forgetPartnerLinks();
}

test("a partner and its clients never fall back to the site's AI", async () => {
  const { d, partnerId, clientId, client } = await withClient();
  const env = d.env as never;
  // No keys anywhere: the AI stops with a clear error, and the label says so.
  for (const id of [partnerId, clientId]) {
    await assert.rejects(aiOverride(env, id, client.id), (e: { code?: string }) => e.code === "ai_key_required");
    assert.equal((await companyAiChoice(env, id)).source, "none");
  }
  // The partner adds its key: the client uses it, and the partner pays.
  await saveCompanyAi(d, partnerId, "sk-ant-partner-key-AAAA");
  const used = await aiOverride(env, clientId, client.id);
  assert.equal(used?.apiKey, "sk-ant-partner-key-AAAA");
  assert.equal(used?.partner, "Brightline");
  assert.equal((await companyAiChoice(env, clientId)).source, "partner");
  // The client adds its own key: it wins.
  await saveCompanyAi(d, clientId, "sk-ant-client-key-BBBB");
  assert.equal((await aiOverride(env, clientId, client.id))?.apiKey, "sk-ant-client-key-BBBB");
  // An ordinary company still uses the site's AI.
  const other = d.person("solo@else.test");
  const mine = await d.call(other, "POST", "/api/companies", { name: "Solo Shop" });
  assert.equal(await aiOverride(env, (mine.json!.company as { id: string }).id, other.id), null);
});

test("a super admin can let a partner use the site's AI", async () => {
  const { d, admin, partnerId, clientId, client } = await withClient();
  const env = d.env as never;
  const off = await d.call(admin, "PUT", `/api/site/partners/company/${partnerId}`, { ownAiRequired: false });
  assert.equal(off.status, 200, off.text);
  assert.equal((off.json as { ownAiRequired: boolean }).ownAiRequired, false);
  assert.equal(await aiOverride(env, clientId, client.id), null);
  const list = await d.call(admin, "GET", "/api/site/partners");
  assert.equal((list.json!.domains as Array<{ ownAiRequired: boolean }>)[0]!.ownAiRequired, false);
});

test("the Jev key comes from the company, then the partner, never the site's for a partner", async () => {
  const { d, agency, partnerId, clientId } = await withClient();
  const env = { ...d.env, TYPESAFE_API_KEY: "site-typesafe-key-000000" } as never;
  assert.deepEqual(await companyServiceKey(env, clientId, "typesafe"), { key: null, source: "none" });
  const saved = await d.call(agency, "PUT", `/api/companies/${partnerId}/keys/typesafe`, { apiKey: "partner-typesafe-key-1111" });
  assert.equal(saved.status, 200, saved.text);
  assert.equal((saved.json!.keys as Array<{ keyHint: string; source: string }>)[0]!.keyHint, "1111");
  assert.deepEqual(await companyServiceKey(env, clientId, "typesafe"), { key: "partner-typesafe-key-1111", source: "partner" });
  // The key never comes back.
  assert.ok(!JSON.stringify((await d.call(agency, "GET", `/api/companies/${partnerId}/keys`)).json).includes("partner-typesafe-key"));
  // An ordinary company uses the site's key.
  const other = d.person("solo2@else.test");
  const mine = await d.call(other, "POST", "/api/companies", { name: "Solo Two" });
  assert.deepEqual(await companyServiceKey(env, (mine.json!.company as { id: string }).id, "typesafe"), { key: "site-typesafe-key-000000", source: "deploy" });
  // Only owners change keys.
  const helper = d.person("helper@brightline.test");
  d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)").run(partnerId, helper.id, new Date().toISOString());
  assert.equal((await d.call(helper, "PUT", `/api/companies/${partnerId}/keys/typesafe`, { apiKey: "admin-typesafe-key-2222" })).status, 403);
  assert.equal((await d.call(helper, "GET", `/api/companies/${partnerId}/keys`)).status, 200);
});

test("pausing a partner turns off its apps and its host, and resuming brings them back", async () => {
  const { d, admin, agency, partnerId, clientId, client, onHost } = await withClient();
  const env = d.env as never;
  const paused = await d.call(admin, "PUT", `/api/site/partners/company/${partnerId}`, { paused: true });
  assert.equal(paused.status, 200, paused.text);
  for (const id of [partnerId, clientId]) {
    const state = await companyAppState(env, id);
    assert.equal(state.pausedBy, "Brightline");
    assert.equal(state.enabled("projects"), false);
  }
  // The host answers only what the paused page needs.
  const config = await onHost(null, "GET", "/api/config");
  assert.equal((config.json!.partner as { paused: boolean }).paused, true);
  const me = await onHost(client, "GET", "/api/me");
  assert.equal(me.status, 403);
  assert.equal(me.json!.code, "partner_paused");
  assert.equal((await onHost(null, "POST", "/api/auth/request-code", { email: "dr@alder.test" })).status, 403);
  // On the site's own host, the client still signs in, and the company list says why the apps are off.
  const list = await d.call(client, "GET", "/api/companies");
  assert.equal((list.json!.companies as Array<{ id: string; pausedBy: string | null }>).find((k) => k.id === clientId)!.pausedBy, "Brightline");
  // A project route says that the partner is paused.
  if (d.app.routes.some((r) => r.path === "/api/projects")) {
    const p = await d.call(agency, "POST", "/api/projects", { name: "Launch", companyId: partnerId });
    assert.equal(p.json!.code, "partner_paused", p.text);
  }
  // Data stays, and a resume brings everything back.
  assert.equal(d.all("SELECT id FROM companies WHERE id IN (?, ?)", partnerId, clientId).length, 2);
  await d.call(admin, "PUT", `/api/site/partners/company/${partnerId}`, { paused: false });
  assert.equal((await companyAppState(env, clientId)).pausedBy, null);
  assert.equal((await onHost(client, "GET", "/api/me")).status, 200);
});

test("only a super admin pauses a partner, and only a partner can be paused", async () => {
  const { d, agency, admin, partnerId } = await withClient();
  assert.equal((await d.call(agency, "PUT", `/api/site/partners/company/${partnerId}`, { paused: true })).status, 403);
  const other = d.person("solo3@else.test");
  const mine = await d.call(other, "POST", "/api/companies", { name: "Not A Partner" });
  const r = await d.call(admin, "PUT", `/api/site/partners/company/${(mine.json!.company as { id: string }).id}`, { paused: true });
  assert.equal(r.status, 404);
  assert.equal((await d.call(admin, "PUT", `/api/site/partners/company/${partnerId}`, {})).status, 400);
});

test("owners can invite owners; admins cannot", async () => {
  const { d, agency, clientId } = await withClient();
  const invited = await d.call(agency, "POST", `/api/companies/${clientId}/members`, { email: "co-owner@alder.test", role: "owner" });
  assert.equal(invited.status, 201, invited.text);
  assert.equal(d.all("SELECT role FROM company_invitations WHERE company_id = ? AND email = ?", clientId, "co-owner@alder.test")[0]!.role, "owner");
  const helper = d.person("admin2@alder.test");
  d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)").run(clientId, helper.id, new Date().toISOString());
  assert.equal((await d.call(helper, "POST", `/api/companies/${clientId}/members`, { email: "x@alder.test", role: "owner" })).status, 403);
});

test("a super admin hands a client company over when its partner is gone", async () => {
  const { d, admin, agency, partnerId, clientId, client } = await withClient();
  const listed = await d.call(admin, "GET", `/api/site/partners/company/${partnerId}/clients`);
  assert.equal(listed.status, 200, listed.text);
  const people = (listed.json!.clients as Array<{ id: string; people: Array<{ userId: string; role: string; partnerPerson: boolean }> }>)[0]!.people;
  assert.deepEqual(people.map((p) => [p.userId, p.role, p.partnerPerson]), [
    [agency.id, "owner", true],
    [client.id, "member", false]
  ]);
  // A guest cannot become an owner.
  const guest = d.person("guest@alder.test");
  d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'guest', ?)").run(clientId, guest.id, new Date().toISOString());
  assert.equal((await d.call(admin, "POST", `/api/site/partners/clients/${clientId}/handover`, { userId: guest.id })).status, 400);
  // The partner itself is not a client company.
  assert.equal((await d.call(admin, "POST", `/api/site/partners/clients/${partnerId}/handover`, { userId: agency.id })).status, 400);

  await d.call(admin, "PUT", `/api/site/partners/company/${partnerId}`, { paused: true });
  const done = await d.call(admin, "POST", `/api/site/partners/clients/${clientId}/handover`, { userId: client.id, removePartnerPeople: true, release: true });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json!.removed, 1);
  assert.deepEqual(
    d.all("SELECT user_id, role FROM company_members WHERE company_id = ? AND role != 'guest'", clientId).map((r) => ({ ...r })),
    [{ user_id: client.id, role: "owner" }]
  );
  // Released: no longer counted, no longer paused, and back on the site's own AI rules.
  assert.equal(d.all("SELECT partner_id FROM companies WHERE id = ?", clientId)[0]!.partner_id, null);
  assert.equal((await companyAppState(d.env as never, clientId)).pausedBy, null);
  assert.equal(await aiOverride(d.env as never, clientId, client.id), null);
  // Only a super admin can hand over.
  assert.equal((await d.call(agency, "GET", `/api/site/partners/company/${partnerId}/clients`)).status, 403);
});
