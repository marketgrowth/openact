import { HttpError, newId, nowIso, type Env } from "@openact/core/server";
import {
  COMPANY_SETTING_KEYS,
  DEFAULT_SETTINGS,
  MAX_MINE_BYTES,
  MAX_MINE_ITEMS,
  MAX_RESOURCES,
  MAX_TERMS_PER_KIND,
  SETTING_KEYS,
  TERM_KINDS,
  chunksOf,
  hasTerms,
  matches,
  publishProblem,
  siteOf,
  videoOf,
  type Format,
  type ManageCounts,
  type ManageTab,
  type MineState,
  type Origin,
  type Resource,
  type ResourceFields,
  type Scope,
  type Settings,
  type Status,
  type Term,
  type TermKind
} from "../shared/rules.ts";
import { cleanTermName } from "./validate.ts";

/*
 * The Library's data, at three levels (see rules.ts, Scope):
 * - vault: the site's Content Vault. Site owners manage it. No company_id.
 * - company: one company's library. Every row has company_id.
 * - personal: one person's private My Library item. company_id and owner_user_id.
 * Every function takes a `Where` that names the level, so a query never reads across companies.
 * Callers check access first: requireSuperAdmin for the vault, library.manage for a company, library.view for readers.
 */

export type Where = { scope: "vault" } | { scope: "company"; companyId: string } | { scope: "personal"; companyId: string; userId: string };
export const VAULT: Where = { scope: "vault" };
export const companyWhere = (companyId: string): Where => ({ scope: "company", companyId });

function whereSql(w: Where, alias = "r"): { sql: string; binds: string[] } {
  if (w.scope === "vault") return { sql: `${alias}.scope = 'vault'`, binds: [] };
  if (w.scope === "company") return { sql: `${alias}.scope = 'company' AND ${alias}.company_id = ?`, binds: [w.companyId] };
  return { sql: `${alias}.scope = 'personal' AND ${alias}.company_id = ? AND ${alias}.owner_user_id = ?`, binds: [w.companyId, w.userId] };
}

/** The company whose list values a level uses. The vault uses the site's lists (null). My Library uses the company's. */
const termCompany = (w: Where): string | null => (w.scope === "vault" ? null : w.companyId);

/* Settings */

function mergeInto(s: Settings, key: string, json: string, keys: readonly string[]) {
  if (!keys.includes(key)) return;
  try {
    const v = JSON.parse(json) as never;
    if (key === "lists") {
      for (const kind of TERM_KINDS) if ((v as Settings["lists"])[kind]) s.lists[kind] = (v as Settings["lists"])[kind];
    } else (s as unknown as Record<string, unknown>)[key] = v;
  } catch {
    // A broken value keeps the one before it.
  }
}

/** The site's settings. They are also the defaults for every company. */
export async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare("SELECT key, value_json FROM library_settings").all<{ key: string; value_json: string }>();
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const r of results) mergeInto(s, r.key, r.value_json, SETTING_KEYS);
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

/** A company's settings: the site's, with the company's own value for each key it set. */
export async function loadCompanySettings(env: Env, companyId: string): Promise<Settings> {
  const s = await loadSettings(env);
  const { results } = await env.DB.prepare("SELECT key, value_json FROM library_company_settings WHERE company_id = ?").bind(companyId).all<{ key: string; value_json: string }>();
  for (const r of results) mergeInto(s, r.key, r.value_json, COMPANY_SETTING_KEYS as string[]);
  return s;
}

export async function saveCompanySettings(env: Env, companyId: string, s: Settings, userId: string): Promise<void> {
  const now = nowIso();
  await env.DB.batch(
    COMPANY_SETTING_KEYS.map((k) =>
      env.DB.prepare(
        `INSERT INTO library_company_settings (company_id, key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (company_id, key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).bind(companyId, k, JSON.stringify(s[k]), userId, now)
    )
  );
}

/** Settings for a level: the site's for the vault, the company's otherwise. */
export const settingsFor = (env: Env, w: Where) => (w.scope === "vault" ? loadSettings(env) : loadCompanySettings(env, w.companyId));

/* List values */

type TermRow = { id: string; kind: TermKind; name: string; sort_order: number; is_hidden: number };
const toTerm = (r: TermRow): Term => ({ id: r.id, kind: r.kind, name: r.name, sortOrder: r.sort_order, isHidden: r.is_hidden === 1 });
const termWhere = (companyId: string | null) => (companyId ? { sql: "company_id = ?", binds: [companyId] } : { sql: "company_id IS NULL", binds: [] as string[] });

export async function listAllTerms(env: Env, companyId: string | null = null): Promise<Term[]> {
  const w = termWhere(companyId);
  const { results } = await env.DB.prepare(`SELECT id, kind, name, sort_order, is_hidden FROM library_terms WHERE ${w.sql} ORDER BY kind, sort_order, name`)
    .bind(...w.binds)
    .all<TermRow>();
  return results.map(toTerm);
}

/**
 * A company starts with a copy of the site's visible list values, once. A company that deleted
 * or renamed its values keeps its own: the flag `_terms_seeded` marks the copy as done.
 */
export async function ensureCompanyTerms(env: Env, companyId: string): Promise<void> {
  const done = await env.DB.prepare("SELECT 1 FROM library_company_settings WHERE company_id = ? AND key = '_terms_seeded'").bind(companyId).first();
  if (done) return;
  const site = (await listAllTerms(env, null)).filter((t) => !t.isHidden);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO library_company_settings (company_id, key, value_json, updated_by, updated_at) VALUES (?, '_terms_seeded', 'true', NULL, ?)`
    ).bind(companyId, now),
    ...site.map((t) =>
      env.DB.prepare("INSERT INTO library_terms (id, kind, name, sort_order, is_hidden, company_id, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)").bind(
        newId(),
        t.kind,
        t.name,
        t.sortOrder,
        companyId,
        now,
        now
      )
    )
  ]);
}

async function termOr404(env: Env, id: string, companyId: string | null): Promise<TermRow> {
  const w = termWhere(companyId);
  const r = await env.DB.prepare(`SELECT id, kind, name, sort_order, is_hidden FROM library_terms WHERE id = ? AND ${w.sql}`)
    .bind(id, ...w.binds)
    .first<TermRow>();
  if (!r) throw new HttpError(404, "That list value does not exist. Reload the page.");
  return r;
}

async function nameTaken(env: Env, companyId: string | null, kind: TermKind, name: string, exceptId: string | null): Promise<boolean> {
  const w = termWhere(companyId);
  const r = await env.DB.prepare(`SELECT id FROM library_terms WHERE ${w.sql} AND kind = ? AND lower(name) = lower(?) AND id != ?`)
    .bind(...w.binds, kind, name, exceptId ?? "")
    .first();
  return !!r;
}

export async function addTerm(env: Env, companyId: string | null, kind: TermKind, rawName: unknown): Promise<Term> {
  const name = cleanTermName(rawName);
  const w = termWhere(companyId);
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), -1) AS top FROM library_terms WHERE ${w.sql} AND kind = ?`)
    .bind(...w.binds, kind)
    .first<{ n: number; top: number }>();
  if ((count?.n ?? 0) >= MAX_TERMS_PER_KIND) throw new HttpError(400, `A list can hold ${MAX_TERMS_PER_KIND} values or fewer. Hide or rename one instead.`);
  if (await nameTaken(env, companyId, kind, name, null)) throw new HttpError(409, `The list already has "${name}".`);
  const now = nowIso();
  const id = newId();
  const sort = (count?.top ?? -1) + 1;
  await env.DB.prepare("INSERT INTO library_terms (id, kind, name, sort_order, is_hidden, company_id, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)")
    .bind(id, kind, name, sort, companyId, now, now)
    .run();
  return { id, kind, name, sortOrder: sort, isHidden: false };
}

/** Renames, hides or shows, or moves a list value one place up or down. */
export async function changeTerm(env: Env, companyId: string | null, id: string, b: Record<string, unknown>): Promise<void> {
  const t = await termOr404(env, id, companyId);
  const now = nowIso();
  if (b.name !== undefined) {
    const name = cleanTermName(b.name);
    if (await nameTaken(env, companyId, t.kind, name, id)) throw new HttpError(409, `The list already has "${name}".`);
    await env.DB.prepare("UPDATE library_terms SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, id).run();
  }
  if (b.isHidden !== undefined) {
    if (typeof b.isHidden !== "boolean") throw new HttpError(400, "Hidden must be true or false.");
    await env.DB.prepare("UPDATE library_terms SET is_hidden = ?, updated_at = ? WHERE id = ?").bind(b.isHidden ? 1 : 0, now, id).run();
  }
  if (b.move !== undefined) {
    if (b.move !== "up" && b.move !== "down") throw new HttpError(400, 'Move must be "up" or "down".');
    const w = termWhere(companyId);
    const { results } = await env.DB.prepare(`SELECT id FROM library_terms WHERE ${w.sql} AND kind = ? ORDER BY sort_order, name`)
      .bind(...w.binds, t.kind)
      .all<{ id: string }>();
    const i = results.findIndex((r) => r.id === id);
    const j = b.move === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= results.length) return;
    const order = results.map((r) => r.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    await env.DB.batch(order.map((tid, n) => env.DB.prepare("UPDATE library_terms SET sort_order = ?, updated_at = ? WHERE id = ?").bind(n, now, tid)));
  }
}

/** Only ids of list values that exist at this level. A company resource never takes another company's values. */
async function knownTermIds(env: Env, w: Where, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const all = new Set((await listAllTerms(env, termCompany(w))).map((t) => t.id));
  return ids.filter((id) => all.has(id));
}

/* Resources */

type ResourceRow = {
  id: string;
  scope: Scope;
  company_id: string | null;
  owner_user_id: string | null;
  format: Format;
  title: string;
  summary: string;
  body: string;
  source_url: string;
  image_url: string;
  site_name: string;
  video_provider: Resource["videoProvider"];
  video_ref: string;
  file_key: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  status: Status;
  is_featured: number;
  origin: Origin;
  automation_name: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  term_ids: string | null;
};

const SELECT = `SELECT r.id, r.scope, r.company_id, r.owner_user_id, r.format, r.title, r.summary, r.body, r.source_url, r.image_url, r.site_name,
    r.video_provider, r.video_ref, r.file_key, r.file_name, r.file_type, r.file_size, r.status, r.is_featured, r.origin, a.name AS automation_name,
    r.published_at, r.created_by, r.created_at, r.updated_at,
    (SELECT group_concat(t.term_id) FROM library_resource_terms t WHERE t.resource_id = r.id) AS term_ids
  FROM library_resources r LEFT JOIN library_automations a ON a.id = r.automation_id`;

const toResource = (r: ResourceRow): Resource => ({
  id: r.id,
  scope: r.scope,
  companyId: r.company_id,
  ownerUserId: r.owner_user_id,
  format: r.format,
  title: r.title,
  summary: r.summary,
  body: r.body,
  sourceUrl: r.source_url,
  imageUrl: r.image_url,
  siteName: r.site_name,
  featured: r.is_featured === 1,
  termIds: r.term_ids ? r.term_ids.split(",") : [],
  status: r.status,
  origin: r.origin,
  automationName: r.automation_name ?? "",
  videoProvider: r.video_provider,
  videoRef: r.video_ref,
  fileName: r.file_name,
  fileType: r.file_type,
  fileSize: r.file_size,
  hasFile: !!r.file_key,
  publishedAt: r.published_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

export async function getResource(env: Env, id: string): Promise<Resource | null> {
  const r = await env.DB.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first<ResourceRow>();
  return r ? toResource(r) : null;
}

/** A resource at this level, or 404. A route can never reach a row at another level or in another company. */
export async function resourceIn(env: Env, w: Where, id: string): Promise<Resource> {
  const q = whereSql(w);
  const r = await env.DB.prepare(`${SELECT} WHERE r.id = ? AND ${q.sql}`)
    .bind(id, ...q.binds)
    .first<ResourceRow>();
  if (!r) throw new HttpError(404, "That resource is not in the library. It may have been deleted.");
  return toResource(r);
}

/** True when this person may open this resource inside this company. */
export function canRead(r: Resource, companyId: string, userId: string, isManager: boolean): boolean {
  if (r.companyId !== companyId) return false;
  if (r.scope === "company") return r.status === "published" || isManager;
  if (r.scope === "personal") return r.ownerUserId === userId;
  return false;
}

export async function fileKeyOf(env: Env, id: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT file_key FROM library_resources WHERE id = ?").bind(id).first<{ file_key: string | null }>();
  return r?.file_key ?? null;
}

export interface ReaderFilter {
  q?: string;
  formats?: Format[];
  terms?: Partial<Record<TermKind, string[]>>;
  sort?: "newest" | "title";
}

function applyFilter(items: Resource[], f: ReaderFilter): Resource[] {
  let out = items;
  if (f.formats?.length) out = out.filter((r) => f.formats!.includes(r.format));
  if (f.terms) out = out.filter((r) => hasTerms(r.termIds, f.terms!));
  if (f.q) out = out.filter((r) => matches([r.title, r.summary, r.body, r.siteName].join(" "), f.q!));
  if (f.sort === "title") out.sort((a, b) => a.title.localeCompare(b.title));
  else out.sort((a, b) => Number(b.featured) - Number(a.featured) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return out;
}

/** Published resources at a level: a company's library for its readers, or the vault for other apps of the site. */
export async function publishedResources(env: Env, w: Where, f: ReaderFilter = {}): Promise<Resource[]> {
  const q = whereSql(w);
  const { results } = await env.DB.prepare(`${SELECT} WHERE ${q.sql} AND r.status = 'published' ORDER BY r.published_at DESC LIMIT ?`)
    .bind(...q.binds, MAX_RESOURCES)
    .all<ResourceRow>();
  return applyFilter(results.map(toResource), f);
}

function tabSql(w: Where, tab: ManageTab): string {
  if (w.scope !== "vault") return { review: "0", drafts: "r.status = 'draft'", published: "r.status = 'published'", archived: "r.status = 'archived'" }[tab];
  return {
    review: "r.status = 'draft' AND r.origin != 'person'",
    drafts: "r.status = 'draft' AND r.origin = 'person'",
    published: "r.status = 'published'",
    archived: "r.status = 'archived'"
  }[tab];
}

export async function manageList(env: Env, w: Where, tab: ManageTab, q = ""): Promise<Resource[]> {
  const ws = whereSql(w);
  const { results } = await env.DB.prepare(`${SELECT} WHERE ${ws.sql} AND ${tabSql(w, tab)} ORDER BY r.updated_at DESC LIMIT ?`)
    .bind(...ws.binds, MAX_RESOURCES)
    .all<ResourceRow>();
  const items = results.map(toResource);
  return q ? items.filter((r) => matches([r.title, r.summary, r.siteName].join(" "), q)) : items;
}

export async function manageCounts(env: Env, w: Where): Promise<ManageCounts> {
  const ws = whereSql(w);
  const vault = w.scope === "vault";
  const r = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'draft' AND (? = 1 AND origin != 'person') THEN 1 ELSE 0 END) AS review,
       SUM(CASE WHEN status = 'draft' AND (? = 0 OR origin = 'person') THEN 1 ELSE 0 END) AS drafts,
       SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
     FROM library_resources r WHERE ${ws.sql}`
  )
    .bind(vault ? 1 : 0, vault ? 1 : 0, ...ws.binds)
    .first<Record<keyof ManageCounts, number | null>>();
  return { review: r?.review ?? 0, drafts: r?.drafts ?? 0, published: r?.published ?? 0, archived: r?.archived ?? 0 };
}

/** What the server adds to a resource beyond the editable fields. */
export interface ResourceExtra {
  /** The level. Default: the vault (automations and agents feed it). */
  where?: Where;
  origin?: Origin;
  automationId?: string | null;
  status?: Status;
  file?: { key: string; name: string; type: string; size: number } | null;
  /** Text from a page or a file, for the Ask index only. */
  extractedText?: string;
}

/** The video of a resource: a linked YouTube or Vimeo video, or an uploaded file. */
function videoFields(f: ResourceFields, hasFile: boolean): { provider: Resource["videoProvider"]; ref: string } {
  if (f.format !== "video") return { provider: "", ref: "" };
  const v = f.sourceUrl ? videoOf(f.sourceUrl) : null;
  if (v) return { provider: v.provider, ref: v.ref };
  return hasFile ? { provider: "upload", ref: "" } : { provider: "", ref: "" };
}

/** My Library limits: items and file bytes for one person in one company. */
export async function checkMineRoom(env: Env, companyId: string, userId: string, addBytes = 0): Promise<void> {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM library_resources WHERE scope = 'personal' AND company_id = ? AND owner_user_id = ?"
  )
    .bind(companyId, userId)
    .first<{ n: number; bytes: number }>();
  if ((r?.n ?? 0) >= MAX_MINE_ITEMS) throw new HttpError(400, `My Library holds ${MAX_MINE_ITEMS} items. Delete some first.`);
  if ((r?.bytes ?? 0) + addBytes > MAX_MINE_BYTES) throw new HttpError(400, "Your files in My Library would pass 500 MB. Delete some files first.");
}

export async function createResource(env: Env, f: ResourceFields, x: ResourceExtra, userId: string | null): Promise<string> {
  const w = x.where ?? VAULT;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM library_resources").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_RESOURCES * 20) throw new HttpError(400, "The site holds the most resources it can. Delete old ones first.");
  const scoped = whereSql(w);
  const inLevel = await env.DB.prepare(`SELECT COUNT(*) AS n FROM library_resources r WHERE ${scoped.sql}`)
    .bind(...scoped.binds)
    .first<{ n: number }>();
  if ((inLevel?.n ?? 0) >= MAX_RESOURCES) throw new HttpError(400, `The library holds ${MAX_RESOURCES} resources, the most it can. Delete old ones first.`);
  const id = newId();
  const now = nowIso();
  // A My Library item is private, so it is ready at once.
  const status = w.scope === "personal" ? "published" : (x.status ?? "draft");
  const termIds = await knownTermIds(env, w, f.termIds);
  const video = videoFields(f, !!x.file);
  if (status === "published") {
    const problem = publishProblem({ ...f, hasFile: !!x.file });
    if (problem) throw new HttpError(400, problem);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO library_resources (id, scope, company_id, owner_user_id, format, title, summary, body, source_url, image_url, site_name, video_provider, video_ref,
         file_key, file_name, file_type, file_size, extracted_text, status, is_featured, origin, automation_id, published_at,
         created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      w.scope,
      w.scope === "vault" ? null : w.companyId,
      w.scope === "personal" ? w.userId : null,
      f.format,
      f.title,
      f.summary,
      f.body,
      f.sourceUrl,
      f.imageUrl,
      f.siteName || siteOf(f.sourceUrl),
      video.provider,
      video.ref,
      x.file?.key ?? null,
      x.file?.name ?? "",
      x.file?.type ?? "",
      x.file?.size ?? 0,
      (x.extractedText ?? "").slice(0, 200000),
      status,
      f.featured && w.scope !== "personal" ? 1 : 0,
      x.origin ?? "person",
      x.automationId ?? null,
      status === "published" ? now : null,
      userId,
      userId,
      now,
      now
    ),
    ...termIds.map((t) => env.DB.prepare("INSERT INTO library_resource_terms (resource_id, term_id) VALUES (?, ?)").bind(id, t))
  ]);
  await rebuildChunks(env, id);
  return id;
}

export async function saveResource(env: Env, w: Where, id: string, f: ResourceFields, userId: string): Promise<void> {
  const before = await resourceIn(env, w, id);
  if (before.hasFile && f.format !== before.format && (f.format === "article" || f.format === "link")) {
    throw new HttpError(400, "This resource has an uploaded file. Keep it a document or a video, or add the file as a new resource.");
  }
  if (before.status === "published") {
    const problem = publishProblem({ ...f, hasFile: before.hasFile });
    if (problem) throw new HttpError(400, problem);
  }
  const termIds = await knownTermIds(env, w, f.termIds);
  const video = videoFields(f, before.hasFile);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE library_resources SET format = ?, title = ?, summary = ?, body = ?, source_url = ?, image_url = ?, site_name = ?,
         video_provider = ?, video_ref = ?, is_featured = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(
      f.format,
      f.title,
      f.summary,
      f.body,
      f.sourceUrl,
      f.imageUrl,
      f.siteName || siteOf(f.sourceUrl),
      video.provider,
      video.ref,
      f.featured && w.scope !== "personal" ? 1 : 0,
      userId,
      now,
      id
    ),
    env.DB.prepare("DELETE FROM library_resource_terms WHERE resource_id = ?").bind(id),
    ...termIds.map((t) => env.DB.prepare("INSERT INTO library_resource_terms (resource_id, term_id) VALUES (?, ?)").bind(id, t))
  ]);
  await rebuildChunks(env, id);
}

export type StatusAction = "publish" | "unpublish" | "archive" | "restore";
export const STATUS_ACTIONS: readonly StatusAction[] = ["publish", "unpublish", "archive", "restore"];

/** Publish, take back to draft, archive or restore. In the vault, review before publish needs another site owner. */
export async function changeStatus(env: Env, w: Where, id: string, action: StatusAction, s: Settings, userId: string): Promise<void> {
  const r = await resourceIn(env, w, id);
  if (w.scope === "personal") throw new HttpError(400, "A My Library item has no status. Edit it or delete it.");
  const now = nowIso();
  let next: Status;
  if (action === "publish") {
    const problem = publishProblem(r);
    if (problem) throw new HttpError(400, problem);
    if (w.scope === "vault" && s.reviewOn && r.origin === "person" && r.createdBy === userId) {
      throw new HttpError(403, "Review before publish is on. Another site owner must publish a resource that you added.");
    }
    next = "published";
  } else if (action === "unpublish" || action === "restore") next = "draft";
  else next = "archived";
  await env.DB.prepare(
    `UPDATE library_resources SET status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END,
       updated_by = ?, updated_at = ? WHERE id = ?`
  )
    .bind(next, next, now, userId, now, id)
    .run();
}

/** Deletes a resource, its file and its index. A dismissed automation entry stays marked as seen, so it does not come back. */
export async function deleteResource(env: Env, w: Where, id: string): Promise<void> {
  await resourceIn(env, w, id);
  const key = await fileKeyOf(env, id);
  await env.DB.prepare("DELETE FROM library_resources WHERE id = ?").bind(id).run();
  if (key) await env.FILES.delete(key).catch(() => undefined);
}

/** Rebuilds the Ask index of one resource from its title, summary, text and extracted text. */
export async function rebuildChunks(env: Env, id: string): Promise<void> {
  const r = await env.DB.prepare("SELECT title, summary, body, extracted_text FROM library_resources WHERE id = ?")
    .bind(id)
    .first<{ title: string; summary: string; body: string; extracted_text: string }>();
  if (!r) return;
  const parts = chunksOf([r.summary, r.body, r.extracted_text].filter(Boolean).join("\n\n"));
  const chunks = parts.length ? parts : [r.title];
  await env.DB.batch([
    env.DB.prepare("DELETE FROM library_chunks WHERE resource_id = ?").bind(id),
    ...chunks.map((text, i) => env.DB.prepare("INSERT INTO library_chunks (resource_id, seq, text) VALUES (?, ?, ?)").bind(id, i, text))
  ]);
}

export async function setExtractedText(env: Env, id: string, text: string): Promise<void> {
  await env.DB.prepare("UPDATE library_resources SET extracted_text = ? WHERE id = ?").bind(text.slice(0, 200000), id).run();
  await rebuildChunks(env, id);
}

export interface ChunkRow {
  resourceId: string;
  seq: number;
  text: string;
  title: string;
  format: Format;
  sourceUrl: string;
  personal: boolean;
}

/**
 * The Ask index for one person in one company: the company's published resources and the person's own My Library.
 * Never the vault, never another company, never another person's items.
 */
export async function askChunks(env: Env, companyId: string, userId: string, onlyId?: string): Promise<ChunkRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.resource_id, c.seq, c.text, r.title, r.format, r.source_url, r.scope FROM library_chunks c
     JOIN library_resources r ON r.id = c.resource_id
     WHERE r.company_id = ? AND (
       (r.scope = 'company' AND r.status = 'published') OR (r.scope = 'personal' AND r.owner_user_id = ?)
     ) ${onlyId ? "AND r.id = ?" : ""}
     ORDER BY r.published_at DESC, c.seq LIMIT 50000`
  )
    .bind(companyId, userId, ...(onlyId ? [onlyId] : []))
    .all<{ resource_id: string; seq: number; text: string; title: string; format: Format; source_url: string; scope: Scope }>();
  return results.map((r) => ({ resourceId: r.resource_id, seq: r.seq, text: r.text, title: r.title, format: r.format, sourceUrl: r.source_url, personal: r.scope === "personal" }));
}

/** The Ask index of one level's published resources, for the service and the agent tools. */
export async function publishedChunks(env: Env, w: Where): Promise<ChunkRow[]> {
  const q = whereSql(w);
  const { results } = await env.DB.prepare(
    `SELECT c.resource_id, c.seq, c.text, r.title, r.format, r.source_url FROM library_chunks c
     JOIN library_resources r ON r.id = c.resource_id
     WHERE ${q.sql} AND r.status = 'published' ORDER BY r.published_at DESC, c.seq LIMIT 50000`
  )
    .bind(...q.binds)
    .all<{ resource_id: string; seq: number; text: string; title: string; format: Format; source_url: string }>();
  return results.map((r) => ({ resourceId: r.resource_id, seq: r.seq, text: r.text, title: r.title, format: r.format, sourceUrl: r.source_url, personal: false }));
}

/** A resource with the same source link at this level, so one link is not added twice. */
export async function resourceByUrl(env: Env, url: string, w: Where = VAULT): Promise<string | null> {
  if (!url) return null;
  const q = whereSql(w);
  const r = await env.DB.prepare(`SELECT r.id FROM library_resources r WHERE r.source_url = ? AND ${q.sql} LIMIT 1`)
    .bind(url, ...q.binds)
    .first<{ id: string }>();
  return r?.id ?? null;
}

/* My Library */

export async function mineState(env: Env, companyId: string, userId: string): Promise<MineState> {
  const saved = await env.DB.prepare(
    `${SELECT} JOIN library_bookmarks b ON b.resource_id = r.id
     WHERE b.company_id = ? AND b.user_id = ? AND r.scope = 'company' AND r.company_id = ? AND r.status = 'published'
     ORDER BY b.created_at DESC`
  )
    .bind(companyId, userId, companyId)
    .all<ResourceRow>();
  const added = await env.DB.prepare(`${SELECT} WHERE r.scope = 'personal' AND r.company_id = ? AND r.owner_user_id = ? ORDER BY r.created_at DESC`)
    .bind(companyId, userId)
    .all<ResourceRow>();
  const ids = await env.DB.prepare("SELECT resource_id FROM library_bookmarks WHERE company_id = ? AND user_id = ?").bind(companyId, userId).all<{ resource_id: string }>();
  return { saved: saved.results.map(toResource), added: added.results.map(toResource), savedIds: ids.results.map((r) => r.resource_id) };
}

export async function mineCounts(env: Env, companyId: string, userId: string): Promise<{ saved: number; added: number }> {
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM library_bookmarks b JOIN library_resources r ON r.id = b.resource_id
         WHERE b.company_id = ?1 AND b.user_id = ?2 AND r.status = 'published') AS saved,
       (SELECT COUNT(*) FROM library_resources WHERE scope = 'personal' AND company_id = ?1 AND owner_user_id = ?2) AS added`
  )
    .bind(companyId, userId)
    .first<{ saved: number; added: number }>();
  return { saved: r?.saved ?? 0, added: r?.added ?? 0 };
}

/** Saves a published company resource to the person's My Library. */
export async function addBookmark(env: Env, companyId: string, userId: string, resourceId: string): Promise<void> {
  const r = await getResource(env, resourceId);
  if (!r || r.scope !== "company" || r.companyId !== companyId || r.status !== "published") throw new HttpError(404, "That resource is not in the company library.");
  await env.DB.prepare("INSERT OR IGNORE INTO library_bookmarks (company_id, user_id, resource_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(companyId, userId, resourceId, nowIso())
    .run();
}

export async function removeBookmark(env: Env, companyId: string, userId: string, resourceId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM library_bookmarks WHERE company_id = ? AND user_id = ? AND resource_id = ?").bind(companyId, userId, resourceId).run();
}

/* Cleanup */

async function deleteFiles(env: Env, sql: string, binds: string[]): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT file_key FROM library_resources WHERE file_key IS NOT NULL AND ${sql}`)
    .bind(...binds)
    .all<{ file_key: string }>();
  for (const r of results) await env.FILES.delete(r.file_key).catch(() => undefined);
}

/** A person left the company: their My Library there goes, with its files and bookmarks. */
export async function removeMember(env: Env, companyId: string, userId: string): Promise<void> {
  await deleteFiles(env, "scope = 'personal' AND company_id = ? AND owner_user_id = ?", [companyId, userId]);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM library_resources WHERE scope = 'personal' AND company_id = ? AND owner_user_id = ?").bind(companyId, userId),
    env.DB.prepare("DELETE FROM library_bookmarks WHERE company_id = ? AND user_id = ?").bind(companyId, userId)
  ]);
}

/** A company is deleted: its library, its people's My Library items, its lists and settings go, with their files. */
export async function removeCompany(env: Env, companyId: string): Promise<void> {
  await deleteFiles(env, "company_id = ?", [companyId]);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM library_bookmarks WHERE company_id = ?").bind(companyId),
    env.DB.prepare("DELETE FROM library_resources WHERE company_id = ?").bind(companyId),
    env.DB.prepare("DELETE FROM library_terms WHERE company_id = ?").bind(companyId),
    env.DB.prepare("DELETE FROM library_company_settings WHERE company_id = ?").bind(companyId)
  ]);
}
