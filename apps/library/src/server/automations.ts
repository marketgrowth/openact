import { HttpError, newId, nowIso, randomToken, sha256Hex, text, type Env } from "@openact/core/server";
import {
  AUTOMATION_KINDS,
  MAX_AUTOMATIONS,
  MAX_ENTRIES_PER_RUN,
  MAX_SUMMARY,
  MAX_TITLE,
  PAUSE_AFTER_FAILS,
  WEBHOOK_PER_HOUR,
  siteOf,
  videoOf,
  type Automation,
  type AutomationKind,
  type FeedEntry,
  type Run,
  type Settings,
  type Term
} from "../shared/rules.ts";
import { createResource, listAllTerms, loadSettings, resourceByUrl } from "./store.ts";
import { findFeed, previewPage } from "./fetch.ts";
import { aiFill } from "./fill.ts";
import { bool, cleanEvery, ids, obj, url } from "./validate.ts";

/*
 * Automations add resources without a person.
 * - Feed or blog, and video channel: the cron job reads the feed when it is due and adds new entries.
 * - Webhook: another tool posts a link to /api/apps/library/inbound/<key>. Only the hash of the key is stored.
 * New resources go to To review as drafts, unless the automation publishes them.
 */

type Row = {
  id: string;
  kind: AutomationKind;
  name: string;
  url: string;
  feed_url: string;
  key_last4: string;
  every_minutes: number;
  terms_json: string;
  is_auto_publish: number;
  is_paused: number;
  fail_count: number;
  last_run_at: string | null;
  last_error: string;
  last_note: string | null;
};

const COLS = `a.id, a.kind, a.name, a.url, a.feed_url, a.key_last4, a.every_minutes, a.terms_json, a.is_auto_publish, a.is_paused,
  a.fail_count, a.last_run_at, a.last_error,
  (SELECT r.note FROM library_runs r WHERE r.automation_id = a.id ORDER BY r.ran_at DESC LIMIT 1) AS last_note`;

function toAutomation(r: Row): Automation {
  let termIds: string[] = [];
  try {
    termIds = JSON.parse(r.terms_json) as string[];
  } catch {
    termIds = [];
  }
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    url: r.url,
    feedUrl: r.feed_url,
    keyLast4: r.key_last4,
    everyMinutes: r.every_minutes,
    termIds,
    autoPublish: r.is_auto_publish === 1,
    paused: r.is_paused === 1,
    failCount: r.fail_count,
    lastRunAt: r.last_run_at,
    lastError: r.last_error,
    lastNote: r.last_note ?? ""
  };
}

export async function listAutomations(env: Env): Promise<Automation[]> {
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM library_automations a ORDER BY a.created_at`).all<Row>();
  return results.map(toAutomation);
}

export async function automationOr404(env: Env, id: string): Promise<Automation> {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM library_automations a WHERE a.id = ?`).bind(id).first<Row>();
  if (!r) throw new HttpError(404, "That automation does not exist. Reload the page.");
  return toAutomation(r);
}

export async function recentRuns(env: Env, limit = 20): Promise<Run[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.automation_id, a.name, r.ran_at, r.added_count, r.is_published, r.note, r.error
     FROM library_runs r JOIN library_automations a ON a.id = r.automation_id ORDER BY r.ran_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<{ id: string; automation_id: string; name: string; ran_at: string; added_count: number; is_published: number; note: string; error: string }>();
  return results.map((r) => ({
    id: r.id,
    automationId: r.automation_id,
    automationName: r.name,
    ranAt: r.ran_at,
    addedCount: r.added_count,
    published: r.is_published === 1,
    note: r.note,
    error: r.error
  }));
}

async function cleanTermIds(env: Env, raw: unknown): Promise<string[]> {
  const want = ids(raw, "The list values", 6);
  const known = new Set((await listAllTerms(env)).map((t) => t.id));
  return want.filter((id) => known.has(id));
}

export interface NewAutomation {
  automation: Automation;
  /** The webhook key, shown once. Empty for other kinds. */
  key: string;
}

/** Adds an automation. A feed starts with the entries the manager picked; the older ones are marked as seen. */
export async function createAutomation(env: Env, raw: unknown, userId: string): Promise<NewAutomation> {
  const b = obj(raw, "the automation");
  const kind = AUTOMATION_KINDS.includes(b.kind as AutomationKind) ? (b.kind as AutomationKind) : null;
  if (!kind) throw new HttpError(400, "Pick where new resources come from: a feed, a video channel or a webhook.");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM library_automations").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_AUTOMATIONS) throw new HttpError(400, `A site can have ${MAX_AUTOMATIONS} automations. Delete one first.`);
  const name = text(b.name, "Name", { max: 80, required: true });
  const termIds = await cleanTermIds(env, b.termIds);
  const autoPublish = b.autoPublish === undefined ? false : bool(b.autoPublish, "Publish each new item");
  const every = cleanEvery(b.everyMinutes);
  const now = nowIso();
  const id = newId();
  let key = "";
  let keyHash: string | null = null;
  let source = "";
  let feedUrl = "";
  let entries: FeedEntry[] = [];
  if (kind === "webhook") {
    key = `lib_${randomToken(24)}`;
    keyHash = await sha256Hex(key);
  } else {
    source = url(b.url, "The address");
    if (!source) throw new HttpError(400, "Add the address of the feed, blog or channel.");
    const found = await findFeed(kind, source);
    feedUrl = found.feedUrl;
    entries = found.entries;
  }
  await env.DB.prepare(
    `INSERT INTO library_automations (id, kind, name, url, feed_url, key_hash, key_last4, every_minutes, terms_json, is_auto_publish, is_paused, fail_count,
       last_run_at, last_error, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, '', ?, ?, ?)`
  )
    .bind(id, kind, name, source, feedUrl, keyHash, key.slice(-4), every, JSON.stringify(termIds), autoPublish ? 1 : 0, userId, now, now)
    .run();
  if (kind !== "webhook") {
    const startWith = Math.max(0, Math.min(typeof b.startWith === "number" ? Math.floor(b.startWith) : 0, MAX_ENTRIES_PER_RUN));
    // Entries past the first `startWith` are old news: mark them seen, so only newer ones come in.
    const old = entries.slice(startWith);
    if (old.length) {
      await env.DB.batch(
        old.map((e) => env.DB.prepare("INSERT OR IGNORE INTO library_automation_entries (automation_id, entry_url, seen_at) VALUES (?, ?, ?)").bind(id, e.url, now))
      );
    }
    if (startWith) await addEntries(env, await automationOr404(env, id), entries.slice(0, startWith), await loadSettings(env), await listAllTerms(env));
  }
  return { automation: await automationOr404(env, id), key };
}

export async function updateAutomation(env: Env, id: string, raw: unknown): Promise<Automation> {
  const a = await automationOr404(env, id);
  const b = obj(raw, "the automation");
  const name = b.name === undefined ? a.name : text(b.name, "Name", { max: 80, required: true });
  const termIds = b.termIds === undefined ? a.termIds : await cleanTermIds(env, b.termIds);
  const autoPublish = b.autoPublish === undefined ? a.autoPublish : bool(b.autoPublish, "Publish each new item");
  const paused = b.paused === undefined ? a.paused : bool(b.paused, "Paused");
  const every = b.everyMinutes === undefined ? a.everyMinutes : cleanEvery(b.everyMinutes);
  await env.DB.prepare(
    `UPDATE library_automations SET name = ?, terms_json = ?, is_auto_publish = ?, is_paused = ?, every_minutes = ?,
       fail_count = CASE WHEN ? = 0 THEN 0 ELSE fail_count END, updated_at = ? WHERE id = ?`
  )
    .bind(name, JSON.stringify(termIds), autoPublish ? 1 : 0, paused ? 1 : 0, every, paused ? 1 : 0, nowIso(), id)
    .run();
  return automationOr404(env, id);
}

/** A new webhook key. The old key stops working at once. */
export async function newWebhookKey(env: Env, id: string): Promise<string> {
  const a = await automationOr404(env, id);
  if (a.kind !== "webhook") throw new HttpError(400, "Only a webhook has a key.");
  const key = `lib_${randomToken(24)}`;
  await env.DB.prepare("UPDATE library_automations SET key_hash = ?, key_last4 = ?, updated_at = ? WHERE id = ?").bind(await sha256Hex(key), key.slice(-4), nowIso(), id).run();
  return key;
}

export async function deleteAutomation(env: Env, id: string): Promise<void> {
  await automationOr404(env, id);
  await env.DB.prepare("DELETE FROM library_automations WHERE id = ?").bind(id).run();
}

async function logRun(env: Env, a: Automation, r: { added: number; note: string; error: string }): Promise<void> {
  const now = nowIso();
  const failed = !!r.error;
  const pause = failed && a.kind !== "webhook" && a.failCount + 1 >= PAUSE_AFTER_FAILS;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO library_runs (id, automation_id, ran_at, added_count, is_published, note, error) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      newId(),
      a.id,
      now,
      r.added,
      a.autoPublish && r.added > 0 ? 1 : 0,
      r.note,
      r.error + (pause ? ` Paused after ${PAUSE_AFTER_FAILS} tries.` : "")
    ),
    env.DB.prepare(
      `UPDATE library_automations SET last_run_at = ?, last_error = ?, fail_count = ?, is_paused = CASE WHEN ? = 1 THEN 1 ELSE is_paused END WHERE id = ?`
    ).bind(now, r.error, failed ? a.failCount + 1 : 0, pause ? 1 : 0, a.id),
    // Keep the log short: the last 200 runs.
    env.DB.prepare("DELETE FROM library_runs WHERE id NOT IN (SELECT id FROM library_runs ORDER BY ran_at DESC LIMIT 200)")
  ]);
}

const describe = (n: number, publish: boolean) => (n === 0 ? "No new items" : `${n} ${publish ? "published" : "added to To review"}`);

/** Adds feed entries as resources. Skips links that are already in the library. */
async function addEntries(env: Env, a: Automation, entries: FeedEntry[], s: Settings, terms: Term[]): Promise<number> {
  let added = 0;
  const now = nowIso();
  for (const e of entries.slice(0, MAX_ENTRIES_PER_RUN)) {
    await env.DB.prepare("INSERT OR IGNORE INTO library_automation_entries (automation_id, entry_url, seen_at) VALUES (?, ?, ?)").bind(a.id, e.url, now).run();
    if (await resourceByUrl(env, e.url)) continue;
    const video = videoOf(e.url);
    const fill = await aiFill(env, s, terms, { title: e.title, summary: e.summary, text: "" });
    const imageUrl = e.imageUrl || (video?.provider === "youtube" ? `https://i.ytimg.com/vi/${video.ref}/hqdefault.jpg` : "");
    await createResource(
      env,
      {
        format: video ? "video" : "link",
        title: e.title.slice(0, MAX_TITLE),
        summary: fill.summary.slice(0, MAX_SUMMARY),
        body: "",
        sourceUrl: e.url,
        imageUrl,
        siteName: siteOf(e.url),
        featured: false,
        termIds: [...new Set([...a.termIds, ...fill.termIds])]
      },
      { origin: a.kind === "video_channel" ? "video_channel" : "feed", automationId: a.id, status: a.autoPublish ? "published" : "draft", extractedText: e.summary },
      null
    );
    added++;
  }
  return added;
}

/** Reads one feed now and adds its new entries. Logs the run. */
export async function runFeed(env: Env, a: Automation): Promise<Run | null> {
  if (a.kind === "webhook") throw new HttpError(400, "A webhook runs when another tool calls it.");
  try {
    const found = await findFeed(a.kind, a.feedUrl || a.url);
    const urls = found.entries.map((e) => e.url);
    const seen = new Set<string>();
    for (let i = 0; i < urls.length; i += 50) {
      const part = urls.slice(i, i + 50);
      const { results } = await env.DB.prepare(
        `SELECT entry_url FROM library_automation_entries WHERE automation_id = ? AND entry_url IN (${part.map(() => "?").join(",")})`
      )
        .bind(a.id, ...part)
        .all<{ entry_url: string }>();
      for (const r of results) seen.add(r.entry_url);
    }
    const fresh = found.entries.filter((e) => !seen.has(e.url));
    const added = await addEntries(env, a, fresh, await loadSettings(env), await listAllTerms(env));
    await logRun(env, a, { added, note: describe(added, a.autoPublish), error: "" });
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : "The feed could not be read.";
    await logRun(env, a, { added: 0, note: "", error: msg });
  }
  return (await recentRuns(env, 50)).find((r) => r.automationId === a.id) ?? null;
}

/** Runs the feeds that are due. The cron job calls it every 10 minutes. A few feeds per run keep the job short. */
export async function runDueFeeds(env: Env, now = Date.now(), max = 5): Promise<number> {
  const all = (await listAutomations(env)).filter((a) => a.kind !== "webhook" && !a.paused);
  const due = all
    .filter((a) => !a.lastRunAt || Date.parse(a.lastRunAt) + a.everyMinutes * 60000 - 60000 <= now)
    .sort((x, y) => (x.lastRunAt ?? "").localeCompare(y.lastRunAt ?? ""))
    .slice(0, max);
  for (const a of due) await runFeed(env, a);
  return due.length;
}

/** A webhook call: { url, title?, summary?, type?, topics?, audience? }. Type and topic names must match the site's lists. */
export async function inbound(env: Env, key: string, raw: unknown): Promise<{ id: string; status: "draft" | "published"; duplicate: boolean }> {
  const hash = await sha256Hex(key);
  const row = await env.DB.prepare(`SELECT ${COLS} FROM library_automations a WHERE a.key_hash = ? AND a.kind = 'webhook'`).bind(hash).first<Row>();
  if (!row) throw new HttpError(404, "Unknown key. Check the webhook address in the Library's Automations.");
  const a = toAutomation(row);
  if (a.paused) throw new HttpError(409, "This webhook is paused. A manager can turn it on in the Library's Automations.");
  const hour = new Date(Date.now() - 3600000).toISOString();
  const calls = await env.DB.prepare("SELECT COUNT(*) AS n FROM library_runs WHERE automation_id = ? AND ran_at > ?").bind(a.id, hour).first<{ n: number }>();
  if ((calls?.n ?? 0) >= WEBHOOK_PER_HOUR) throw new HttpError(429, `This webhook took ${WEBHOOK_PER_HOUR} calls in the last hour. Try again later.`);
  const b = obj(raw, "the resource");
  const link = url(b.url);
  if (!link) throw new HttpError(400, "Send the resource's link as url.");
  const existing = await resourceByUrl(env, link);
  if (existing) {
    await logRun(env, a, { added: 0, note: "Already in the library", error: "" });
    const st = await env.DB.prepare("SELECT status FROM library_resources WHERE id = ?").bind(existing).first<{ status: string }>();
    return { id: existing, status: st?.status === "published" ? "published" : "draft", duplicate: true };
  }
  const s = await loadSettings(env);
  const terms = await listAllTerms(env);
  let title = text(b.title, "Title", { max: MAX_TITLE });
  let summary = text(b.summary, "Summary", { max: MAX_SUMMARY });
  let imageUrl = "";
  let siteName = siteOf(link);
  let pageText = "";
  let format: "link" | "video" | "document" = videoOf(link) ? "video" : "link";
  try {
    const p = await previewPage(link);
    title ||= p.title;
    summary ||= p.summary;
    imageUrl = p.imageUrl;
    siteName = p.siteName;
    pageText = p.text;
    format = p.format === "article" ? "link" : p.format;
  } catch {
    // The page did not answer. Keep what the caller sent.
  }
  const byName = (kind: Term["kind"], v: unknown) =>
    typeof v === "string" ? terms.find((t) => t.kind === kind && t.name.toLowerCase() === v.trim().toLowerCase())?.id : undefined;
  const named = [
    byName("type", b.type),
    ...(Array.isArray(b.topics) ? b.topics.slice(0, 6).map((n) => byName("topic", n)) : [byName("topic", b.topic)]),
    byName("audience", b.audience)
  ].filter((x): x is string => !!x);
  const fill = await aiFill(env, s, terms, { title: title || siteName, summary, text: pageText });
  const id = await createResource(
    env,
    {
      format,
      title: (title || siteName || "Untitled link").slice(0, MAX_TITLE),
      summary: (summary || fill.summary).slice(0, MAX_SUMMARY),
      body: "",
      sourceUrl: link,
      imageUrl,
      siteName,
      featured: false,
      termIds: [...new Set([...a.termIds, ...named, ...(named.length ? [] : fill.termIds)])]
    },
    { origin: "webhook", automationId: a.id, status: a.autoPublish ? "published" : "draft", extractedText: pageText },
    null
  );
  await logRun(env, a, { added: 1, note: describe(1, a.autoPublish), error: "" });
  return { id, status: a.autoPublish ? "published" : "draft", duplicate: false };
}
