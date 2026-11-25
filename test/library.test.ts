import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeploy, type Deploy, type Person } from "./harness/deploy.ts";
import { appService } from "../packages/core/src/server/apps.ts";
import { chunksOf, cleanUrl, embedUrl, hasTerms, publishProblem, videoOf, EMPTY_FIELDS } from "../apps/library/src/shared/rules.ts";
import { citationsOf, groupByResource, rankChunks, words, type Chunk } from "../apps/library/src/server/ask.ts";
import { htmlToText, parseFeed } from "../apps/library/src/server/fetch.ts";
import { runDueFeeds } from "../apps/library/src/server/automations.ts";
import type { LibraryContentService } from "../apps/library/src/server/service.ts";

/* The Library app: a resource library that super admins manage, automations feed, and every company reads and asks. */

const L = "/api/apps/library";

async function ok(p: Promise<{ status: number; text: string; json: Record<string, unknown> | null }>, what: string, status = 200) {
  const r = await p;
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text}`);
  return r.json as Record<string, any>;
}

type World = { d: Deploy; root: Person; second: Person; reader: Person; companyId: string };

async function world(vars: Record<string, string> = {}): Promise<World> {
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "root@deploy.test,second@deploy.test", AI_PROVIDER: "dev-scripted", ...vars });
  const root = d.person("root@deploy.test", "Root");
  const second = d.person("second@deploy.test", "Second");
  const reader = d.person("reader@home.test", "Reader");
  const made = await d.call(reader, "POST", "/api/companies", { name: "Oak Lane" });
  assert.ok(made.status >= 200 && made.status < 300, made.text);
  const companyId = d.one<{ id: string }>("SELECT company_id AS id FROM company_members WHERE user_id = ?", reader.id).id;
  return { d, root, second, reader, companyId };
}

async function term(w: World, kind: string, name: string): Promise<string> {
  const r = await ok(w.d.call(w.root, "POST", `${L}/manage/terms`, { kind, name }), `term ${name}`, 201);
  return r.term.id;
}

async function add(w: World, fields: Record<string, unknown>, publish = true): Promise<string> {
  const r = await ok(w.d.call(w.root, "POST", `${L}/manage/resources`, { fields: { ...EMPTY_FIELDS, ...fields }, publish }), `add ${fields.title}`, 201);
  return r.item.id;
}

/** Replaces fetch for the length of `fn`. `route` answers by URL. Calls to the app itself never use global fetch. */
async function withFetch<T>(route: (url: string, init?: RequestInit) => Response | Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => route(String(url instanceof Request ? url.url : url), init)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const html = (title: string, desc: string, body = "") =>
  new Response(`<html><head><title>x</title><meta property="og:title" content="${title}"><meta name="description" content="${desc}"><meta property="og:image" content="/img.png"></head><body><main>${body}</main></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });

const rss = (items: Array<{ title: string; link: string }>) =>
  new Response(
    `<?xml version="1.0"?><rss version="2.0"><channel><title>Industry News</title>${items
      .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>&lt;p&gt;About ${i.title}&lt;/p&gt;</description><pubDate>Mon, 23 Nov 2026 10:00:00 GMT</pubDate></item>`)
      .join("")}</channel></rss>`,
    { headers: { "content-type": "application/rss+xml" } }
  );

/** The AG-UI events in an SSE answer. */
function events(text: string): Array<Record<string, any>> {
  return text
    .split("\n\n")
    .map((f) => f.trim())
    .filter((f) => f.startsWith("data:"))
    .map((f) => JSON.parse(f.slice(5)));
}

async function askRun(w: World, question: string, extra: Record<string, unknown> = {}) {
  const r = await w.d.call(w.reader, "POST", `${L}/companies/${w.companyId}/ask`, {
    threadId: "t1",
    runId: "r1",
    messages: [...((extra.history as unknown[]) ?? []), { id: "m", role: "user", content: question }],
    forwardedProps: extra.forwardedProps ?? {}
  });
  return { status: r.status, text: r.text, events: r.status === 200 ? events(r.text) : [] };
}

test("shared rules: links, videos, chunks and what publishing needs", () => {
  assert.deepEqual(cleanUrl("example.com/page"), { url: "https://example.com/page" });
  assert.ok("problem" in cleanUrl("http://example.com"));
  assert.ok("problem" in cleanUrl("javascript:alert(1)"));
  assert.ok("problem" in cleanUrl("https://user:pw@example.com"));
  assert.deepEqual(videoOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), { provider: "youtube", ref: "dQw4w9WgXcQ" });
  assert.deepEqual(videoOf("https://youtu.be/dQw4w9WgXcQ"), { provider: "youtube", ref: "dQw4w9WgXcQ" });
  assert.deepEqual(videoOf("https://vimeo.com/123456789"), { provider: "vimeo", ref: "123456789" });
  assert.equal(videoOf("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(embedUrl("youtube", "dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(chunksOf("a b c d e", 2).length, 3);
  assert.equal(chunksOf("", 2).length, 0);
  assert.ok(hasTerms(["a", "b"], { topic: ["b", "c"] }));
  assert.ok(!hasTerms(["a"], { type: ["b"] }));
  const base = { ...EMPTY_FIELDS, hasFile: false };
  assert.match(publishProblem({ ...base })!, /title/);
  assert.match(publishProblem({ ...base, title: "T", format: "article" })!, /article/);
  assert.match(publishProblem({ ...base, title: "T", format: "document" })!, /file/);
  assert.equal(publishProblem({ ...base, title: "T", format: "document", hasFile: true }), null);
  assert.equal(publishProblem({ ...base, title: "T", sourceUrl: "https://x.com" }), null);
});

test("reading other sites: feeds, pages and private hosts", async () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>One &amp; two</title><link rel="alternate" href="/posts/1"/><updated>2026-11-20T00:00:00Z</updated><summary>Hi</summary></entry></feed>`;
  const a = parseFeed(atom, "https://example.com/feed");
  assert.equal(a.title, "Blog");
  assert.deepEqual(a.entries.map((e) => [e.title, e.url]), [["One & two", "https://example.com/posts/1"]]);
  const r = parseFeed(await rss([{ title: "News 1", link: "https://news.example.com/1" }]).text(), "https://news.example.com/feed");
  assert.equal(r.entries[0]!.summary, "About News 1");
  assert.equal(htmlToText("<p>Hi <b>there</b></p><script>bad()</script>"), "Hi there");

  const w = await world();
  await withFetch(
    () => html("A guide to pricing", "How to price services.", "Long text about pricing."),
    async () => {
      const p = await ok(w.d.call(w.root, "POST", `${L}/manage/preview`, { url: "https://example.com/guide" }), "preview");
      assert.equal(p.title, "A guide to pricing");
      assert.equal(p.summary, "How to price services.");
      assert.equal(p.imageUrl, "https://example.com/img.png");
      assert.equal(p.format, "link");
    }
  );
  await ok(w.d.call(w.root, "POST", `${L}/manage/preview`, { url: "https://localhost/x" }), "localhost", 400);
  await ok(w.d.call(w.root, "POST", `${L}/manage/preview`, { url: "https://192.168.1.10/x" }), "private ip", 400);
  await ok(w.d.call(w.reader, "POST", `${L}/manage/preview`, { url: "https://example.com/guide" }), "reader", 403);
});

test("resources: managers add and publish, readers see published ones and filter them", async () => {
  const w = await world();
  const guide = await term(w, "type", "Guide");
  const news = await term(w, "type", "News");
  const team = await term(w, "topic", "Team");
  const a = await add(w, { format: "video", title: "Weekly check-in", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", termIds: [guide, team] });
  await add(w, { format: "article", title: "Why we cite sources", body: "Show where each answer comes from.", termIds: [] });
  await add(w, { format: "link", title: "AI search news", sourceUrl: "https://news.example.com/1", termIds: [news] });
  const draft = await add(w, { format: "link", title: "Draft only", sourceUrl: "https://example.com/d" }, false);

  const list = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/resources`), "list");
  assert.deepEqual(list.items.map((r: { title: string }) => r.title).sort(), ["AI search news", "Weekly check-in", "Why we cite sources"]);
  const video = list.items.find((r: { id: string }) => r.id === a);
  assert.equal(video.videoProvider, "youtube");
  assert.equal(video.videoRef, "dQw4w9WgXcQ");
  assert.equal(video.siteName, "youtube.com");

  const only = async (q: string) => (await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/resources?${q}`), q)).items.map((r: { title: string }) => r.title);
  assert.deepEqual(await only("format=article"), ["Why we cite sources"]);
  assert.deepEqual(await only(`type=${guide}`), ["Weekly check-in"]);
  assert.deepEqual(await only("q=search"), ["AI search news"]);
  assert.deepEqual(await only("sort=title"), ["AI search news", "Weekly check-in", "Why we cite sources"]);

  const detail = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/resources/${a}`), "detail");
  assert.equal(detail.item.title, "Weekly check-in");
  await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/resources/${draft}`), "draft hidden", 404);

  // To review holds automation drafts; a person's draft is in Drafts.
  const m = await ok(w.d.call(w.root, "GET", `${L}/manage/resources?tab=drafts`), "drafts");
  assert.deepEqual(m.items.map((r: { id: string }) => r.id), [draft]);
  assert.deepEqual(m.counts, { review: 0, drafts: 1, published: 3, archived: 0 });

  // Archive hides it. Restore makes it a draft. Delete removes it.
  await ok(w.d.call(w.root, "POST", `${L}/manage/resources/${a}/archive`), "archive");
  assert.equal((await only("")).length, 2);
  await ok(w.d.call(w.root, "POST", `${L}/manage/resources/${a}/restore`), "restore");
  await ok(w.d.call(w.root, "DELETE", `${L}/manage/resources/${a}`), "delete");
  await ok(w.d.call(w.root, "GET", `${L}/manage/resources/${a}`), "gone", 404);
  assert.equal(w.d.all("SELECT * FROM library_chunks WHERE resource_id = ?", a).length, 0);

  // One link once. Publishing checks the fields.
  await ok(w.d.call(w.root, "POST", `${L}/manage/resources`, { fields: { ...EMPTY_FIELDS, title: "Again", sourceUrl: "https://news.example.com/1" } }), "duplicate", 409);
  await ok(w.d.call(w.root, "POST", `${L}/manage/resources`, { fields: { ...EMPTY_FIELDS, format: "article", title: "Empty" }, publish: true }), "empty article", 400);

  // Readers cannot manage.
  await ok(w.d.call(w.reader, "POST", `${L}/manage/resources`, { fields: { ...EMPTY_FIELDS, title: "X", sourceUrl: "https://x.com" } }), "reader add", 403);
});

test("review before publish: another manager publishes what a person added", async () => {
  const w = await world();
  await ok(w.d.call(w.root, "PUT", `${L}/manage/settings`, { reviewOn: true }), "review on");
  await ok(w.d.call(w.root, "POST", `${L}/manage/resources`, { fields: { ...EMPTY_FIELDS, title: "X", sourceUrl: "https://x.com" }, publish: true }), "publish at once", 403);
  const id = await add(w, { title: "X", sourceUrl: "https://x.com" }, false);
  await ok(w.d.call(w.root, "POST", `${L}/manage/resources/${id}/publish`), "own", 403);
  await ok(w.d.call(w.second, "POST", `${L}/manage/resources/${id}/publish`), "second");
});

test("files: upload makes a draft; readers get the file only once it is published", async () => {
  const w = await world();
  const f = new FormData();
  f.set("file", new File(["Onboarding checklist. Day one: meet the team."], "client_onboarding-checklist.txt", { type: "text/plain" }));
  const up = await ok(w.d.call(w.root, "POST", `${L}/manage/files`, f), "upload", 201);
  const id = up.item.id;
  assert.equal(up.item.format, "document");
  assert.equal(up.item.title, "client onboarding checklist");
  assert.equal(up.item.status, "draft");
  assert.equal(up.item.hasFile, true);
  await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/files/${id}`), "draft file", 404);
  const own = await w.d.call(w.root, "GET", `${L}/manage/files/${id}`);
  assert.equal(own.status, 200);
  assert.match(own.text, /Onboarding checklist/);
  await ok(w.d.call(w.root, "POST", `${L}/manage/resources/${id}/publish`), "publish");
  const file = await w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/files/${id}`);
  assert.equal(file.status, 200);
  assert.match(file.text, /Day one/);
  // The text of the file feeds Ask.
  assert.ok(w.d.all<{ text: string }>("SELECT text FROM library_chunks WHERE resource_id = ?", id).some((c) => /meet the team/.test(c.text)));

  const bad = new FormData();
  bad.set("file", new File(["x"], "run.exe", { type: "application/x-msdownload" }));
  await ok(w.d.call(w.root, "POST", `${L}/manage/files`, bad), "bad type", 400);
});

test("ask: chunk ranking and citation cleanup", () => {
  assert.deepEqual(words("What is the check-in rule, for 2027?"), ["check", "rule", "2027"]);
  const c = (resourceId: string, title: string, text: string, seq = 0): Chunk => ({ resourceId, seq, text, title, format: "link", sourceUrl: "" });
  const chunks = [c("a", "Pricing guide", "How to set prices."), c("b", "Weekly check-in", "A short weekly meeting with wins."), c("b", "Weekly check-in", "Blockers and next steps.", 1), c("c", "Fire drill", "A form.")];
  const picked = rankChunks(chunks, "weekly meeting");
  assert.deepEqual([...new Set(picked.map((x) => x.resourceId))], ["b"]);
  assert.deepEqual(rankChunks(chunks, "the and of"), []);
  const groups = groupByResource(rankChunks(chunks, "weekly prices"));
  const r = citationsOf("It is [1]. Also [7] and [2].", groups);
  assert.equal(r.answer, "It is [1]. Also  and [2].");
  assert.equal(r.citations.length, 2);
});

test("ask: AG-UI stream from published resources only, with the person's AI rules", async () => {
  const w = await world({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key", CF_ACCOUNT_ID: "acct", AI_GATEWAY_ID: "gw" });
  await add(w, { format: "article", title: "Weekly check-in", body: "Hold a short weekly meeting. Share wins and blockers." });
  await add(w, { format: "article", title: "Secret draft about weekly meetings", body: "Not yet." }, false);
  const sent: { url: string; body: any }[] = [];
  await withFetch(
    (url, init) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Meet each week [1]. See also [4]." }] }), { status: 200 });
    },
    async () => {
      const cfg = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/config`), "config");
      assert.equal(cfg.canAsk, true);
      assert.equal(cfg.ai.source, "deploy");
      const a = await askRun(w, "How often is the weekly meeting?");
      assert.equal(a.status, 200, a.text);
      const types = a.events.map((e) => e.type);
      assert.deepEqual(types, [
        "RUN_STARTED",
        "STEP_STARTED",
        "CUSTOM",
        "STEP_FINISHED",
        "STEP_STARTED",
        "STEP_FINISHED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "CUSTOM",
        "RUN_FINISHED"
      ]);
      assert.deepEqual(a.events[2]!.value, { searched: 1, read: 1 });
      assert.equal(a.events.find((e) => e.type === "TEXT_MESSAGE_CONTENT")!.delta, "Meet each week [1]. See also .");
      const cites = a.events.findLast((e) => e.type === "CUSTOM")!.value;
      assert.deepEqual(cites.citations.map((c: { title: string }) => c.title), ["Weekly check-in"]);
      assert.equal(cites.ai.provider, "anthropic");
      assert.equal(sent.length, 1);
      assert.match(sent[0]!.url, /gateway\.ai\.cloudflare\.com\/v1\/acct\/gw\/anthropic\/v1\/messages/);
      const system: string = sent[0]!.body.system;
      assert.match(system, /\[1\] Article: Weekly check-in/);
      assert.match(system, /Untrusted text/);
      assert.doesNotMatch(system, /Secret draft/, "drafts never go to the model");

      // No chunk matches: no model call.
      const none = await askRun(w, "zebra migration");
      assert.match(none.events.find((e) => e.type === "TEXT_MESSAGE_CONTENT")!.delta, /no published resource/);
      assert.equal(sent.length, 1);

      // A follow-up uses the earlier question to find resources.
      await askRun(w, "and for zebras?", {
        history: [
          { id: "1", role: "user", content: "weekly meeting" },
          { id: "2", role: "assistant", content: "It is [1]." }
        ]
      });
      assert.equal(sent.length, 2);
      assert.equal(sent[1]!.body.messages.length, 3);
    }
  );
});

test("ask: the setting turns it off, and bad input is refused", async () => {
  const w = await world();
  await add(w, { format: "article", title: "Weekly check-in", body: "Meet each week." });
  const a = await askRun(w, "weekly check-in");
  assert.match(a.events.find((e) => e.type === "TEXT_MESSAGE_CONTENT")!.delta, /Dev answer/);
  await ok(w.d.call(w.reader, "POST", `${L}/companies/${w.companyId}/ask`, { messages: [] }), "no question", 400);
  await ok(w.d.call(w.reader, "POST", `${L}/companies/${w.companyId}/ask`, { messages: [{ role: "user", content: "x".repeat(1001) }] }), "long", 400);
  await ok(w.d.call(w.root, "PUT", `${L}/manage/settings`, { askOn: false }), "off");
  const cfg = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/config`), "config");
  assert.equal(cfg.canAsk, false);
  assert.equal(cfg.ai, null);
  assert.equal((await askRun(w, "weekly")).status, 409);
});

test("webhook: a key adds links to To review, or publishes them; a wrong key does nothing", async () => {
  const w = await world();
  const news = await term(w, "type", "News");
  const made = await ok(w.d.call(w.root, "POST", `${L}/manage/automations`, { kind: "webhook", name: "Partner form" }), "webhook", 201);
  const key: string = made.key;
  assert.match(key, /^lib_/);
  assert.equal(made.automation.keyLast4, key.slice(-4));
  assert.ok(!w.d.all<{ key_hash: string }>("SELECT key_hash FROM library_automations").some((r) => r.key_hash === key), "only the hash is stored");

  await withFetch(
    () => html("Partner update", "What changed for partners."),
    async () => {
      const r = await ok(w.d.call(null, "POST", `${L}/inbound/${key}`, { url: "https://partner.example.com/q4", type: "News" }), "inbound", 201);
      assert.equal(r.status, "draft");
      const again = await ok(w.d.call(null, "POST", `${L}/inbound/${key}`, { url: "https://partner.example.com/q4" }), "duplicate");
      assert.equal(again.duplicate, true);
    }
  );
  const review = await ok(w.d.call(w.root, "GET", `${L}/manage/resources?tab=review`), "review");
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].title, "Partner update");
  assert.equal(review.items[0].origin, "webhook");
  assert.equal(review.items[0].automationName, "Partner form");
  assert.deepEqual(review.items[0].termIds, [news]);
  assert.equal(review.counts.review, 1);

  await ok(w.d.call(null, "POST", `${L}/inbound/lib_${"x".repeat(32)}`, { url: "https://x.com" }), "wrong key", 404);
  await ok(w.d.call(w.root, "PATCH", `${L}/manage/automations/${made.automation.id}`, { autoPublish: true }), "auto publish");
  await withFetch(
    () => new Response("down", { status: 500 }),
    async () => {
      const r = await ok(w.d.call(null, "POST", `${L}/inbound/${key}`, { url: "https://partner.example.com/q5", title: "Q5 note" }), "inbound 2", 201);
      assert.equal(r.status, "published");
    }
  );
  const list = await ok(w.d.call(w.reader, "GET", `${L}/companies/${w.companyId}/resources`), "list");
  assert.deepEqual(list.items.map((x: { title: string }) => x.title), ["Q5 note"]);

  // A new key stops the old one.
  const k2 = await ok(w.d.call(w.root, "POST", `${L}/manage/automations/${made.automation.id}/key`), "new key");
  await ok(w.d.call(null, "POST", `${L}/inbound/${key}`, { url: "https://partner.example.com/q6" }), "old key", 404);
  assert.notEqual(k2.key, key);
  const runs = await ok(w.d.call(w.root, "GET", `${L}/manage/automations`), "runs");
  assert.ok(runs.runs.length >= 3);
});

test("feeds: check, start with the latest entries, then add only new ones; pause after failures", async () => {
  const w = await world();
  let items = [
    { title: "News 3", link: "https://news.example.com/3" },
    { title: "News 2", link: "https://news.example.com/2" },
    { title: "News 1", link: "https://news.example.com/1" }
  ];
  let down = false;
  const route = (url: string) => {
    if (down) return new Response("gone", { status: 404 });
    if (url.startsWith("https://news.example.com/feed")) return rss(items);
    if (url === "https://news.example.com/") return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>', { headers: { "content-type": "text/html" } });
    return html("Page", "A page.");
  };
  await withFetch(route, async () => {
    const p = await ok(w.d.call(w.root, "POST", `${L}/manage/automations/preview`, { kind: "feed", url: "https://news.example.com/" }), "preview");
    assert.equal(p.feedUrl, "https://news.example.com/feed.xml");
    assert.equal(p.feedTitle, "Industry News");
    assert.equal(p.entries.length, 3);
    const made = await ok(w.d.call(w.root, "POST", `${L}/manage/automations`, { kind: "feed", name: "Industry news", url: "https://news.example.com/", startWith: 1 }), "create", 201);
    const id = made.automation.id;
    let review = await ok(w.d.call(w.root, "GET", `${L}/manage/resources?tab=review`), "review");
    assert.deepEqual(review.items.map((r: { title: string }) => r.title), ["News 3"]);

    // A run adds only entries the feed did not have before.
    items = [{ title: "News 4", link: "https://news.example.com/4" }, ...items];
    const run = await ok(w.d.call(w.root, "POST", `${L}/manage/automations/${id}/run`), "run");
    assert.equal(run.run.note, "1 added to To review");
    review = await ok(w.d.call(w.root, "GET", `${L}/manage/resources?tab=review`), "review 2");
    assert.deepEqual(review.items.map((r: { title: string }) => r.title).sort(), ["News 3", "News 4"]);

    // A dismissed entry does not come back.
    const n4 = review.items.find((r: { title: string }) => r.title === "News 4").id;
    await ok(w.d.call(w.root, "DELETE", `${L}/manage/resources/${n4}`), "dismiss");
    await ok(w.d.call(w.root, "POST", `${L}/manage/automations/${id}/run`), "run 2");
    review = await ok(w.d.call(w.root, "GET", `${L}/manage/resources?tab=review`), "review 3");
    assert.deepEqual(review.items.map((r: { title: string }) => r.title), ["News 3"]);

    // The cron job runs due feeds. Three failures in a row pause the feed.
    down = true;
    w.d.db.prepare("UPDATE library_automations SET last_run_at = NULL").run();
    for (let i = 0; i < 3; i++) await runDueFeeds(w.d.env as never, Date.now() + i * 3600000 * 2);
    const list = await ok(w.d.call(w.root, "GET", `${L}/manage/automations`), "list");
    assert.equal(list.automations[0].paused, true);
    assert.match(list.automations[0].lastError, /error 404/);
    assert.match(list.runs[0].error, /Paused after 3 tries/);
  });
});

test("service: other apps read published resources and search them", async () => {
  const w = await world();
  const topic = await term(w, "topic", "Team");
  await add(w, { format: "article", title: "Weekly check-in", body: "Meet each week.", termIds: [topic] });
  await add(w, { format: "article", title: "Draft", body: "Weekly." }, false);
  const svc = appService<LibraryContentService>("library", "content");
  assert.ok(svc);
  const env = w.d.env as never;
  assert.deepEqual((await svc!.listResources(env, { topicIds: [topic] })).map((r) => r.title), ["Weekly check-in"]);
  assert.deepEqual((await svc!.search(env, "weekly")).map((r) => r.title), ["Weekly check-in"]);
  assert.deepEqual((await svc!.listTerms(env, "topic")).map((t) => t.name), ["Team"]);
  assert.match(svc!.resourcePath("abc"), /^\/a\/library\/r\/abc$/);
});
