import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHost, cleanPartnerName } from "../packages/core/src/shared/partners.ts";
import { senderFor } from "../packages/core/src/server/email.ts";
import { forgetPartners } from "../packages/core/src/server/partners.ts";
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
