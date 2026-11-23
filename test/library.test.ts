import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeploy, type Deploy, type Person } from "./harness/deploy.ts";
import { appService } from "../packages/core/src/server/apps.ts";
import { cleanUrl, hasTerms, matches, newSince, publishProblem, EMPTY_SOURCE } from "../apps/library/src/shared/rules.ts";
import type { LibraryContentService } from "../apps/library/src/server/service.ts";

/* The Library app: site content that super admins write and publish, and every company reads. */

const L = "/api/apps/library";
const today = () => new Date().toISOString().slice(0, 10);

async function ok(p: Promise<{ status: number; text: string; json: Record<string, unknown> | null }>, what: string, status = 200) {
  const r = await p;
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text}`);
  return r.json as Record<string, any>;
}

type World = { d: Deploy; root: Person; second: Person; reader: Person; companyId: string };

async function world(): Promise<World> {
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "root@deploy.test,second@deploy.test" });
  const root = d.person("root@deploy.test", "Root");
  const second = d.person("second@deploy.test", "Second");
  const reader = d.person("reader@home.test", "Reader");
  const made = await d.call(reader, "POST", "/api/companies", { name: "Oak Lane Care" });
  assert.ok(made.status >= 200 && made.status < 300, made.text);
  const companyId = d.one<{ id: string }>("SELECT company_id AS id FROM company_members WHERE user_id = ?", reader.id).id;
  return { d, root, second, reader, companyId };
}

const checks = (n = 2) => Array.from({ length: n }, () => true);

async function term(w: World, kind: string, name: string): Promise<string> {
  const r = await ok(w.d.call(w.root, "POST", `${L}/manage/terms`, { kind, name }), `term ${name}`, 201);
  return r.term.id;
}

async function publishedSource(w: World, title: string, termIds: string[] = []): Promise<string> {
  const it = await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources`, { title, summary: `${title} summary`, sourceUrl: "https://example.gov/s", termIds }), "source", 201);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${it.id}/publish`, { checks: checks() }), "publish source");
  return it.id;
}

test("shared rules: links, search, lists and what publishing needs", () => {
  assert.deepEqual(cleanUrl("example.gov/page"), { url: "https://example.gov/page" });
  assert.ok("problem" in cleanUrl("http://example.gov"));
  assert.ok("problem" in cleanUrl("javascript:alert(1)"));
  assert.ok("problem" in cleanUrl("https://user:pw@example.gov"));
  assert.deepEqual(cleanUrl(""), { url: "" });
  assert.equal(newSince("2026-11-22", 30), "2026-10-24");
  assert.equal(newSince("2026-11-22", 1), "2026-11-22");
  assert.ok(matches("Bed hold directive for ICF homes", "bed HOLD"));
  assert.ok(!matches("Bed hold directive", "bed rates"));
  assert.ok(hasTerms(["a", "b"], { audience: ["b", "c"] }));
  assert.ok(!hasTerms(["a"], { audience: ["b"] }));
  assert.ok(hasTerms(["a"], { audience: [] }));
  assert.match(publishProblem("source", { ...EMPTY_SOURCE, title: "T" })!, /source link/);
  assert.match(publishProblem("source", { ...EMPTY_SOURCE, title: "T", sourceUrl: "https://x.gov/" })!, /summary/);
});

test("readers see only published copies, and an edit stays a draft until it is published again", async () => {
  const w = await world();
  const item = await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources`, { title: "Appendix J", summary: "How surveyors check", sourceUrl: "https://cms.gov/j" }), "create", 201);
  assert.equal(item.status, "draft");
  assert.equal(item.liveVersion, null);

  let list = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources`), "list");
  assert.equal(list.items.length, 0, "a draft is not visible");
  await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources/${item.id}`), "draft detail", 404);

  // Publish needs every check on the checklist.
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${item.id}/publish`, { checks: [true] }), "one check", 400);
  const pub = await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${item.id}/publish`, { checks: checks() }), "publish");
  assert.equal(pub.status, "published");
  assert.equal(pub.liveVersion, 1);
  assert.equal(pub.canPublish, false, "nothing new to publish");

  list = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources`), "list");
  assert.deepEqual(list.items.map((s: { title: string }) => s.title), ["Appendix J"]);

  // An edit goes back to draft. Readers keep version 1.
  const edited = await ok(w.d.call(w.root, "PUT", `${L}/manage/items/sources/${item.id}`, { title: "Appendix J (2026)", summary: "How surveyors check", sourceUrl: "https://cms.gov/j" }), "edit");
  assert.equal(edited.status, "draft");
  assert.equal(edited.liveVersion, 1);
  let one = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources/${item.id}`), "detail");
  assert.equal(one.item.title, "Appendix J");

  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${item.id}/publish`, { checks: checks() }), "publish v2");
  one = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources/${item.id}`), "detail v2");
  assert.equal(one.item.title, "Appendix J (2026)");
  assert.equal(one.item.version, 2);

  // Archive hides it from readers. Restore brings it back.
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${item.id}/archive`), "archive");
  await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources/${item.id}`), "archived", 404);
  await ok(w.d.call(w.root, "PUT", `${L}/manage/items/sources/${item.id}`, { title: "x" }), "edit archived", 409);
  const back = await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${item.id}/restore`), "restore");
  assert.equal(back.status, "published");
  await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources/${item.id}`), "restored");
});

test("only super admins write, and readers never see working copies", async () => {
  const w = await world();
  await ok(w.d.call(w.reader, "GET", `${L}/manage`), "manage", 403);
  await ok(w.d.call(w.reader, "POST", `${L}/manage/items/updates`, { title: "Planted" }), "create", 403);
  await ok(w.d.call(w.reader, "PUT", `${L}/manage/settings`, { title: "Mine" }), "settings", 403);
  const cfg = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/config`), "config");
  assert.equal(cfg.canManage, false);
  // A person outside the company cannot read through it.
  const stranger = w.d.person("stranger@else.test");
  const out = await w.d.call(stranger, "GET", `${L}/companies/${w.companyId}/sources`);
  assert.ok([403, 404].includes(out.status), `stranger: ${out.status}`);
});

test("updates: the new count, the Updated badge on linked sources, and the publish date", async () => {
  const w = await world();
  const sid = await publishedSource(w, "DHCS rates");
  const u = await ok(
    w.d.call(w.root, "POST", `${L}/manage/items/updates`, {
      title: "CY 2027 rates",
      whatChanged: "New per diem rates.",
      whoAffected: "Every home.",
      action: "Update your budget.",
      actionDueDate: "2027-01-01",
      sourceUrl: "https://dhcs.ca.gov/27-006",
      sourceIds: [sid, "not-a-source"]
    }),
    "update",
    201
  );
  assert.deepEqual(u.fields.sourceIds, [sid], "unknown sources are dropped");
  const old = await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates`, { title: "Old letter", whatChanged: "x", sourceUrl: "https://dhcs.ca.gov/old" }), "old", 201);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates/${u.id}/publish`, { checks: checks() }), "publish");
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates/${old.id}/publish`, { checks: checks(), publishedDate: "2020-01-01" }), "publish old");

  const cfg = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/config`), "config");
  assert.equal(cfg.newCount, 1);
  const ups = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/updates`), "updates");
  assert.deepEqual(ups.items.map((x: { title: string; isNew: boolean }) => [x.title, x.isNew]), [["CY 2027 rates", true], ["Old letter", false]]);
  assert.equal(ups.items[0].publishedDate, today());
  const src = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources/${sid}`), "source");
  assert.equal(src.item.updatedDate, today());
  assert.deepEqual(src.updates.map((x: { title: string }) => x.title), ["CY 2027 rates"]);
  const det = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/updates/${u.id}`), "update detail");
  assert.deepEqual(det.sources, [{ id: sid, title: "DHCS rates" }]);
});

test("filters by list and search; a list that is off does not filter", async () => {
  const w = await world();
  const h = await term(w, "audience", "ICF/DD-H");
  const n = await term(w, "audience", "ICF/DD-N");
  await ok(w.d.call(w.root, "POST", `${L}/manage/terms`, { kind: "audience", name: "icf/dd-h" }), "same name", 409);
  await publishedSource(w, "Only H", [h]);
  await publishedSource(w, "Only N", [n]);
  await publishedSource(w, "Both bed hold", [h, n]);
  const titles = async (qs: string) =>
    (await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/sources${qs}`), qs)).items.map((s: { title: string }) => s.title).sort();
  assert.deepEqual(await titles(`?audience=${h}`), ["Both bed hold", "Only H"]);
  assert.deepEqual(await titles(`?q=bed+hold`), ["Both bed hold"]);
  await ok(w.d.call(w.root, "PUT", `${L}/manage/settings`, { lists: { audience: { on: false } } }), "list off");
  assert.deepEqual(await titles(`?audience=${h}`), ["Both bed hold", "Only H", "Only N"]);
  const cfg = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/config`), "config");
  assert.equal(cfg.terms.length, 0, "a list that is off sends no items");
});

test("lists: rename, hide and move", async () => {
  const w = await world();
  const a = await term(w, "topic", "Licensing");
  const b = await term(w, "topic", "Surveys");
  let r = await ok(w.d.call(w.root, "PATCH", `${L}/manage/terms/${b}`, { move: "up" }), "move");
  assert.deepEqual(r.terms.filter((t: { kind: string }) => t.kind === "topic").map((t: { name: string }) => t.name), ["Surveys", "Licensing"]);
  r = await ok(w.d.call(w.root, "PATCH", `${L}/manage/terms/${a}`, { name: "Licenses", isHidden: true }), "rename and hide");
  const t = r.terms.find((x: { id: string }) => x.id === a);
  assert.equal(t.name, "Licenses");
  assert.equal(t.isHidden, true);
  await ok(w.d.call(w.root, "PATCH", `${L}/manage/terms/${a}`, { name: "Surveys" }), "duplicate", 409);
  await ok(w.d.call(w.root, "PATCH", `${L}/manage/terms/nope`, { name: "X" }), "missing", 404);
});

test("brand settings: saved, merged with defaults, and checked", async () => {
  const w = await world();
  const s = await ok(
    w.d.call(w.root, "PUT", `${L}/manage/settings`, {
      title: "Resource Library",
      updatesName: "Rule updates",
      lists: { audience: { label: "Facility type" } },
      notice: "DirectCare gives guidance, not legal advice.",
      checklist: ["One", "", "Two", "Three"]
    }),
    "save"
  );
  assert.equal(s.settings.title, "Resource Library");
  assert.equal(s.settings.lists.audience.label, "Facility type");
  assert.equal(s.settings.lists.audience.on, true);
  assert.equal(s.settings.lists.category.label, "Category");
  assert.deepEqual(s.settings.checklist, ["One", "Two", "Three"]);
  await ok(w.d.call(w.root, "PUT", `${L}/manage/settings`, { newDays: 0 }), "bad days", 400);
  await ok(w.d.call(w.root, "PUT", `${L}/manage/settings`, { title: "" }), "empty title", 400);
  const cfg = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/config`), "config");
  assert.equal(cfg.settings.updatesName, "Rule updates");

  // The publish check follows the site's checklist length.
  const it = await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources`, { title: "X", summary: "Y", sourceUrl: "https://x.gov" }), "create", 201);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${it.id}/publish`, { checks: checks(2) }), "two checks", 400);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${it.id}/publish`, { checks: checks(3) }), "three checks");
});

test("second reviewer: the writer cannot publish their own item", async () => {
  const w = await world();
  await ok(w.d.call(w.root, "PUT", `${L}/manage/settings`, { requireSecondReviewer: true }), "on");
  const it = await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates`, { title: "APL 26-012", whatChanged: "New rules.", sourceUrl: "https://dhcs.ca.gov/apl" }), "create", 201);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates/${it.id}/publish`, { checks: checks() }), "not in review", 409);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates/${it.id}/submit`), "submit");
  const mine = await ok(w.d.call(w.root, "GET", `${L}/manage/items/updates/${it.id}`), "mine");
  assert.equal(mine.canPublish, false);
  assert.match(mine.publishBlock, /second super admin/);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates/${it.id}/publish`, { checks: checks() }), "own", 409);
  // The reviewer can send it back with a note, or publish it.
  await ok(w.d.call(w.second, "POST", `${L}/manage/items/updates/${it.id}/return`, { note: "" }), "empty note", 400);
  const back = await ok(w.d.call(w.second, "POST", `${L}/manage/items/updates/${it.id}/return`, { note: "Add the due date." }), "return");
  assert.equal(back.status, "draft");
  assert.equal(back.reviewNote, "Add the due date.");
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates/${it.id}/submit`), "submit again");
  const pub = await ok(w.d.call(w.second, "POST", `${L}/manage/items/updates/${it.id}/publish`, { checks: checks() }), "second publishes");
  assert.equal(pub.liveVersion, 1);
  assert.equal(pub.history[0].publishedByName, "Second");
});

test("a draft needs a link and a summary before review; bad input is refused", async () => {
  const w = await world();
  const it = await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources`, { title: "No link yet" }), "create", 201);
  const r = await w.d.call(w.root, "POST", `${L}/manage/items/sources/${it.id}/submit`);
  assert.equal(r.status, 400);
  assert.match(r.text, /source link/);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources`, { title: "Bad", sourceUrl: "http://plain.gov" }), "http", 400);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources`, { title: "" }), "no title", 400);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/pages`, { title: "x" }), "bad kind", 404);
  await ok(w.d.call(w.root, "POST", `${L}/manage/items/sources/${it.id}/delete`), "bad action", 400);
});

test("the content service returns published updates for other apps", async () => {
  const w = await world();
  const h = await term(w, "audience", "ICF/DD-H");
  const n = await term(w, "audience", "ICF/DD-N");
  const mk = async (title: string, termIds: string[], publishedDate: string) => {
    const it = await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates`, { title, whatChanged: "x", sourceUrl: "https://x.gov", termIds }), title, 201);
    await ok(w.d.call(w.root, "POST", `${L}/manage/items/updates/${it.id}/publish`, { checks: checks(), publishedDate }), `publish ${title}`);
  };
  await mk("For H", [h], "2026-11-10");
  await mk("For N", [n], "2026-11-12");
  await mk("Old for H", [h], "2026-01-05");
  const svc = appService<LibraryContentService>("library", "content");
  assert.ok(svc, "the service is registered");
  const got = await svc!.listUpdates(w.d.env as never, { audienceIds: [h], since: "2026-10-01" });
  assert.deepEqual(got.map((u) => u.title), ["For H"]);
  assert.deepEqual((await svc!.listTerms(w.d.env as never, "audience")).map((t) => t.name), ["ICF/DD-H", "ICF/DD-N"]);
  assert.equal(svc!.itemPath("update", "abc"), "/a/library/updates/abc");
});
