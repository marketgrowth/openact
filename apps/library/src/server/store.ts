import { HttpError, newId, nowIso, todayIso, type Env } from "@openact/core/server";
import {
  DEFAULT_SETTINGS,
  MAX_ITEMS,
  MAX_TERMS_PER_KIND,
  SETTING_KEYS,
  hasTerms,
  matches,
  newSince,
  publishProblem,
  sourceText,
  updateText,
  type ItemKind,
  type ManageItem,
  type ManageRow,
  type PublishedSource,
  type PublishedUpdate,
  type Settings,
  type SourceFields,
  type Status,
  type Term,
  type TermKind,
  type UpdateFields
} from "../shared/rules.ts";
import { cleanTermName } from "./validate.ts";

/*
 * The Library's data. The content belongs to the site, not to a company, so no query here takes a company id.
 * Callers check access first: requireSuperAdmin for writes, requirePermission for reads.
 * Readers only ever get published copies (library_versions). Working copies stay with the super admins.
 */

const TABLE: Record<ItemKind, "library_sources" | "library_updates"> = { source: "library_sources", update: "library_updates" };
const TERMS: Record<ItemKind, { table: string; col: string }> = {
  source: { table: "library_source_terms", col: "source_id" },
  update: { table: "library_update_terms", col: "update_id" }
};

/* Settings */

export async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare("SELECT key, value_json FROM library_settings").all<{ key: string; value_json: string }>();
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const r of results) {
    if (!(SETTING_KEYS as string[]).includes(r.key)) continue;
    try {
      const v = JSON.parse(r.value_json) as never;
      const k = r.key as keyof Settings;
      // Nested objects merge, so a new default key still shows on an older site.
      if (k === "lists" || k === "fieldLabels") Object.assign(s[k], v);
      else (s as unknown as Record<string, unknown>)[k] = v;
    } catch {
      // A broken value keeps the default.
    }
  }
  return s;
}

export async function saveSettings(env: Env, s: Settings, userId: string): Promise<void> {
  const now = nowIso();
  await env.DB.batch(
    SETTING_KEYS.map((k) =>
      env.DB.prepare(
        `INSERT INTO library_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).bind(k, JSON.stringify(s[k]), userId, now)
    )
  );
}

/* List items */

type TermRow = { id: string; kind: TermKind; name: string; sort_order: number; is_hidden: number };
const toTerm = (r: TermRow): Term => ({ id: r.id, kind: r.kind, name: r.name, sortOrder: r.sort_order, isHidden: r.is_hidden === 1 });

export async function listAllTerms(env: Env): Promise<Term[]> {
  const { results } = await env.DB.prepare("SELECT id, kind, name, sort_order, is_hidden FROM library_terms ORDER BY kind, sort_order, name").all<TermRow>();
  return results.map(toTerm);
}

async function termOr404(env: Env, id: string): Promise<TermRow> {
  const r = await env.DB.prepare("SELECT id, kind, name, sort_order, is_hidden FROM library_terms WHERE id = ?").bind(id).first<TermRow>();
  if (!r) throw new HttpError(404, "That list item does not exist. Reload the page.");
  return r;
}

async function nameTaken(env: Env, kind: TermKind, name: string, exceptId: string | null): Promise<boolean> {
  const r = await env.DB.prepare("SELECT id FROM library_terms WHERE kind = ? AND lower(name) = lower(?) AND id != ?")
    .bind(kind, name, exceptId ?? "")
    .first();
  return !!r;
}

export async function addTerm(env: Env, kind: TermKind, rawName: unknown): Promise<Term> {
  const name = cleanTermName(rawName);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), -1) AS top FROM library_terms WHERE kind = ?")
    .bind(kind)
    .first<{ n: number; top: number }>();
  if ((count?.n ?? 0) >= MAX_TERMS_PER_KIND) throw new HttpError(400, `A list can hold ${MAX_TERMS_PER_KIND} items or fewer. Hide or rename one instead.`);
  if (await nameTaken(env, kind, name, null)) throw new HttpError(409, `The list already has "${name}".`);
  const now = nowIso();
  const id = newId();
  const sort = (count?.top ?? -1) + 1;
  await env.DB.prepare("INSERT INTO library_terms (id, kind, name, sort_order, is_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
    .bind(id, kind, name, sort, now, now)
    .run();
  return { id, kind, name, sortOrder: sort, isHidden: false };
}

/** Renames, hides or shows, or moves a list item one place up or down. */
export async function changeTerm(env: Env, id: string, b: Record<string, unknown>): Promise<void> {
  const t = await termOr404(env, id);
  const now = nowIso();
  if (b.name !== undefined) {
    const name = cleanTermName(b.name);
    if (await nameTaken(env, t.kind, name, id)) throw new HttpError(409, `The list already has "${name}".`);
    await env.DB.prepare("UPDATE library_terms SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, id).run();
  }
  if (b.isHidden !== undefined) {
    if (typeof b.isHidden !== "boolean") throw new HttpError(400, "Hidden must be true or false.");
    await env.DB.prepare("UPDATE library_terms SET is_hidden = ?, updated_at = ? WHERE id = ?").bind(b.isHidden ? 1 : 0, now, id).run();
  }
  if (b.move !== undefined) {
    if (b.move !== "up" && b.move !== "down") throw new HttpError(400, 'Move must be "up" or "down".');
    const { results } = await env.DB.prepare("SELECT id, sort_order FROM library_terms WHERE kind = ? ORDER BY sort_order, name").bind(t.kind).all<{ id: string; sort_order: number }>();
    const i = results.findIndex((r) => r.id === id);
    const j = b.move === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= results.length) return;
    const order = results.map((r) => r.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    await env.DB.batch(order.map((tid, n) => env.DB.prepare("UPDATE library_terms SET sort_order = ?, updated_at = ? WHERE id = ?").bind(n, now, tid)));
  }
}

/* Published copies: what readers see */

type VersionRow = { item_id: string; version: number; snapshot_json: string; published_at: string };

async function liveVersions(env: Env, kind: ItemKind): Promise<VersionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT v.item_id, v.version, v.snapshot_json, v.published_at
     FROM library_versions v JOIN ${TABLE[kind]} t ON t.id = v.item_id
     WHERE v.item_kind = ? AND t.status != 'archived'
       AND v.version = (SELECT MAX(m.version) FROM library_versions m WHERE m.item_kind = v.item_kind AND m.item_id = v.item_id)
     ORDER BY v.published_at DESC
     LIMIT ?`
  )
    .bind(kind, MAX_ITEMS)
    .all<VersionRow>();
  return results;
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export type Filter = { q?: string; terms?: Partial<Record<TermKind, string[]>> };

export async function publishedUpdates(env: Env, settings: Settings, f: Filter = {}): Promise<PublishedUpdate[]> {
  const since = newSince(todayIso(), settings.newDays);
  const out: PublishedUpdate[] = [];
  for (const r of await liveVersions(env, "update")) {
    const s = parse<UpdateFields>(r.snapshot_json);
    if (!s) continue;
    if (f.q && !matches(updateText(s), f.q)) continue;
    if (f.terms && !hasTerms(s.termIds, f.terms)) continue;
    out.push({ ...s, id: r.item_id, version: r.version, publishedAt: r.published_at, isNew: !!s.publishedDate && s.publishedDate >= since });
  }
  return out.sort((a, b) => (b.publishedDate ?? "").localeCompare(a.publishedDate ?? "") || b.publishedAt.localeCompare(a.publishedAt));
}

export async function publishedSources(env: Env, settings: Settings, f: Filter = {}, terms?: Term[]): Promise<PublishedSource[]> {
  // The Updated badge: the newest new update that changes each source.
  const updated = new Map<string, string>();
  for (const u of await publishedUpdates(env, settings)) {
    if (!u.isNew || !u.publishedDate) continue;
    for (const sid of u.sourceIds) if ((updated.get(sid) ?? "") < u.publishedDate) updated.set(sid, u.publishedDate);
  }
  const rank = new Map((terms ?? (await listAllTerms(env))).filter((t) => t.kind === "category").map((t) => [t.id, t.sortOrder]));
  const firstRank = (s: SourceFields) => Math.min(Infinity, ...s.termIds.map((id) => rank.get(id) ?? Infinity));
  const out: PublishedSource[] = [];
  for (const r of await liveVersions(env, "source")) {
    const s = parse<SourceFields>(r.snapshot_json);
    if (!s) continue;
    if (f.q && !matches(sourceText(s), f.q)) continue;
    if (f.terms && !hasTerms(s.termIds, f.terms)) continue;
    out.push({ ...s, id: r.item_id, version: r.version, publishedAt: r.published_at, updatedDate: updated.get(r.item_id) ?? null });
  }
  // By category order, then by title, as a reader scans a shelf.
  return out.sort((a, b) => firstRank(a) - firstRank(b) || a.title.localeCompare(b.title));
}

/* Working copies: what super admins edit */

type ItemRow = Record<string, unknown> & {
  id: string;
  title: string;
  status: Status;
  review_note: string;
  submitted_by: string | null;
  updated_by: string | null;
  updated_at: string;
};

const userName = async (env: Env, id: string | null): Promise<string | null> =>
  id ? ((await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? null) : null;

async function itemRow(env: Env, kind: ItemKind, id: string): Promise<ItemRow> {
  const r = await env.DB.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`).bind(id).first<ItemRow>();
  if (!r) throw new HttpError(404, "That item does not exist. It may have been removed.");
  return r;
}

async function liveVersion(env: Env, kind: ItemKind, id: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT MAX(version) AS v FROM library_versions WHERE item_kind = ? AND item_id = ?").bind(kind, id).first<{ v: number | null }>();
  return r?.v ?? null;
}

async function itemFields(env: Env, kind: ItemKind, r: ItemRow): Promise<SourceFields | UpdateFields> {
  const t = TERMS[kind];
  const termIds = (await env.DB.prepare(`SELECT term_id FROM ${t.table} WHERE ${t.col} = ?`).bind(r.id).all<{ term_id: string }>()).results.map((x) => x.term_id);
  if (kind === "source") {
    return {
      title: r.title,
      citation: String(r.citation ?? ""),
      summary: String(r.summary ?? ""),
      details: String(r.details ?? ""),
      sourceUrl: String(r.source_url ?? ""),
      lastCheckedDate: (r.last_checked_date as string | null) ?? null,
      termIds
    };
  }
  const sourceIds = (await env.DB.prepare("SELECT source_id FROM library_update_sources WHERE update_id = ?").bind(r.id).all<{ source_id: string }>()).results.map(
    (x) => x.source_id
  );
  return {
    title: r.title,
    whatChanged: String(r.what_changed ?? ""),
    whoAffected: String(r.who_affected ?? ""),
    action: String(r.action ?? ""),
    actionDueDate: (r.action_due_date as string | null) ?? null,
    sourceUrl: String(r.source_url ?? ""),
    publishedDate: (r.published_date as string | null) ?? null,
    termIds,
    sourceIds
  };
}

export async function manageRows(env: Env): Promise<ManageRow[]> {
  const rows: ManageRow[] = [];
  for (const kind of ["source", "update"] as const) {
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.title, t.status, t.updated_at, t.review_note, u.name AS updated_by_name,
              (SELECT MAX(v.version) FROM library_versions v WHERE v.item_kind = ? AND v.item_id = t.id) AS live
       FROM ${TABLE[kind]} t LEFT JOIN users u ON u.id = t.updated_by
       ORDER BY t.updated_at DESC LIMIT ?`
    )
      .bind(kind, MAX_ITEMS)
      .all<{ id: string; title: string; status: Status; updated_at: string; review_note: string; updated_by_name: string | null; live: number | null }>();
    for (const r of results) {
      rows.push({
        kind,
        id: r.id,
        title: r.title,
        status: r.status,
        liveVersion: r.live,
        updatedAt: r.updated_at,
        updatedByName: r.updated_by_name,
        reviewNote: r.review_note
      });
    }
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Why this person cannot publish this item now, or null when they can. */
function publishBlock(kind: ItemKind, r: ItemRow, fields: SourceFields | UpdateFields, live: number | null, settings: Settings, userId: string): string | null {
  if (r.status === "archived") return "Restore this item before you publish it.";
  if (r.status === "published" && live !== null) return "Nothing to publish. Readers already see this version.";
  const missing = publishProblem(kind, fields);
  if (missing) return missing;
  if (settings.requireSecondReviewer) {
    if (r.status !== "in_review") return "Send it for review first. This site needs a second reviewer.";
    if (r.submitted_by === userId || r.updated_by === userId) return "A second super admin must publish this item. You wrote or sent it.";
  }
  return null;
}

export async function manageItem(env: Env, kind: ItemKind, id: string, settings: Settings, userId: string): Promise<ManageItem> {
  const r = await itemRow(env, kind, id);
  const fields = await itemFields(env, kind, r);
  const live = await liveVersion(env, kind, id);
  const { results } = await env.DB.prepare(
    `SELECT v.version, v.published_at, u.name FROM library_versions v LEFT JOIN users u ON u.id = v.published_by
     WHERE v.item_kind = ? AND v.item_id = ? ORDER BY v.version DESC LIMIT 20`
  )
    .bind(kind, id)
    .all<{ version: number; published_at: string; name: string | null }>();
  const block = publishBlock(kind, r, fields, live, settings, userId);
  return {
    kind,
    id,
    status: r.status,
    fields: fields as never,
    liveVersion: live,
    reviewNote: r.review_note,
    submittedByName: await userName(env, r.submitted_by),
    updatedByName: await userName(env, r.updated_by),
    updatedAt: r.updated_at,
    history: results.map((h) => ({ version: h.version, publishedAt: h.published_at, publishedByName: h.name })),
    canPublish: block === null,
    publishBlock: block
  };
}

/** The statements that write the working copy's lists: its terms, and an update's sources. Unknown ids are dropped. */
async function linkStatements(env: Env, kind: ItemKind, id: string, f: SourceFields | UpdateFields) {
  const t = TERMS[kind];
  const known = new Set((await listAllTerms(env)).map((x) => x.id));
  const termIds = f.termIds.filter((x) => known.has(x));
  const st = [env.DB.prepare(`DELETE FROM ${t.table} WHERE ${t.col} = ?`).bind(id)];
  for (const tid of termIds) st.push(env.DB.prepare(`INSERT INTO ${t.table} (${t.col}, term_id) VALUES (?, ?)`).bind(id, tid));
  if (kind === "update") {
    const sourceIds = (f as UpdateFields).sourceIds;
    st.push(env.DB.prepare("DELETE FROM library_update_sources WHERE update_id = ?").bind(id));
    for (const sid of sourceIds) {
      st.push(env.DB.prepare("INSERT INTO library_update_sources (update_id, source_id) SELECT ?, id FROM library_sources WHERE id = ?").bind(id, sid));
    }
  }
  return st;
}

function fieldStatement(env: Env, kind: ItemKind, id: string, f: SourceFields | UpdateFields, status: Status, userId: string, now: string) {
  if (kind === "source") {
    const s = f as SourceFields;
    return env.DB.prepare(
      `UPDATE library_sources SET title = ?, citation = ?, summary = ?, details = ?, source_url = ?, last_checked_date = ?,
         status = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(s.title, s.citation, s.summary, s.details, s.sourceUrl, s.lastCheckedDate, status, userId, now, id);
  }
  const u = f as UpdateFields;
  return env.DB.prepare(
    `UPDATE library_updates SET title = ?, what_changed = ?, who_affected = ?, action = ?, action_due_date = ?, source_url = ?,
       published_date = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?`
  ).bind(u.title, u.whatChanged, u.whoAffected, u.action, u.actionDueDate, u.sourceUrl, u.publishedDate, status, userId, now, id);
}

export async function createItem(env: Env, kind: ItemKind, f: SourceFields | UpdateFields, userId: string): Promise<string> {
  const id = newId();
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ${TABLE[kind]} (id, title, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?)`).bind(
      id,
      f.title,
      userId,
      userId,
      now,
      now
    ),
    fieldStatement(env, kind, id, f, "draft", userId, now),
    ...(await linkStatements(env, kind, id, f))
  ]);
  return id;
}

/** Saves the working copy. A published item goes back to draft, and readers keep the live copy until the next publish. */
export async function saveItem(env: Env, kind: ItemKind, id: string, f: SourceFields | UpdateFields, userId: string): Promise<void> {
  const r = await itemRow(env, kind, id);
  if (r.status === "archived") throw new HttpError(409, "This item is archived. Restore it before you edit it.");
  const status: Status = r.status === "published" ? "draft" : r.status;
  await env.DB.batch([fieldStatement(env, kind, id, f, status, userId, nowIso()), ...(await linkStatements(env, kind, id, f))]);
}

export async function submitItem(env: Env, kind: ItemKind, id: string, userId: string): Promise<void> {
  const r = await itemRow(env, kind, id);
  if (r.status !== "draft") throw new HttpError(409, "Only a draft can go to review.");
  const missing = publishProblem(kind, await itemFields(env, kind, r));
  if (missing) throw new HttpError(400, missing);
  await env.DB.prepare(`UPDATE ${TABLE[kind]} SET status = 'in_review', submitted_by = ?, review_note = '', updated_at = ? WHERE id = ?`)
    .bind(userId, nowIso(), id)
    .run();
}

export async function returnItem(env: Env, kind: ItemKind, id: string, note: string): Promise<void> {
  const r = await itemRow(env, kind, id);
  if (r.status !== "in_review") throw new HttpError(409, "Only an item in review can go back to draft.");
  if (!note) throw new HttpError(400, "Write a note that says what to fix.");
  await env.DB.prepare(`UPDATE ${TABLE[kind]} SET status = 'draft', review_note = ?, updated_at = ? WHERE id = ?`).bind(note, nowIso(), id).run();
}

/** Publishes the working copy as a new version. `checks` must tick every check on the site's review checklist. */
export async function publishItem(
  env: Env,
  kind: ItemKind,
  id: string,
  settings: Settings,
  userId: string,
  opts: { checks: unknown; publishedDate: string | null }
): Promise<number> {
  const r = await itemRow(env, kind, id);
  const fields = await itemFields(env, kind, r);
  const live = await liveVersion(env, kind, id);
  const block = publishBlock(kind, r, fields, live, settings, userId);
  if (block) throw new HttpError(409, block);
  const checks = opts.checks;
  if (!Array.isArray(checks) || checks.length !== settings.checklist.length || checks.some((c) => c !== true)) {
    throw new HttpError(400, "Tick every check on the review checklist before you publish.");
  }
  const now = nowIso();
  const version = (live ?? 0) + 1;
  const st = [];
  if (kind === "update") {
    const u = fields as UpdateFields;
    u.publishedDate = opts.publishedDate ?? u.publishedDate ?? todayIso();
    st.push(env.DB.prepare("UPDATE library_updates SET published_date = ? WHERE id = ?").bind(u.publishedDate, id));
  }
  st.push(
    env.DB.prepare("INSERT INTO library_versions (item_kind, item_id, version, snapshot_json, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      kind,
      id,
      version,
      JSON.stringify(fields),
      userId,
      now
    ),
    env.DB.prepare(`UPDATE ${TABLE[kind]} SET status = 'published', review_note = '', updated_at = ? WHERE id = ?`).bind(now, id)
  );
  await env.DB.batch(st);
  return version;
}

export async function archiveItem(env: Env, kind: ItemKind, id: string): Promise<void> {
  const r = await itemRow(env, kind, id);
  if (r.status === "archived") return;
  await env.DB.prepare(`UPDATE ${TABLE[kind]} SET status = 'archived', updated_at = ? WHERE id = ?`).bind(nowIso(), id).run();
}

/** Brings an archived item back: published when it has a published version, else a draft. */
export async function restoreItem(env: Env, kind: ItemKind, id: string): Promise<void> {
  const r = await itemRow(env, kind, id);
  if (r.status !== "archived") throw new HttpError(409, "Only an archived item can be restored.");
  const status = (await liveVersion(env, kind, id)) === null ? "draft" : "published";
  await env.DB.prepare(`UPDATE ${TABLE[kind]} SET status = ?, updated_at = ? WHERE id = ?`).bind(status, nowIso(), id).run();
}
