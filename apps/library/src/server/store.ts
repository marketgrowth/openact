import { HttpError, newId, nowIso, type Env } from "@openact/core/server";
import {
  DEFAULT_SETTINGS,
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
  type Origin,
  type Resource,
  type ResourceFields,
  type Settings,
  type Status,
  type Term,
  type TermKind
} from "../shared/rules.ts";
import { cleanTermName } from "./validate.ts";

/*
 * The Library's data. The content belongs to the site, not to a company, so no query here takes a company id.
 * Callers check access first: requireSuperAdmin for writes, requirePermission for reads.
 * Readers only ever get published resources.
 */

/* Settings */

export async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare("SELECT key, value_json FROM library_settings").all<{ key: string; value_json: string }>();
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const r of results) {
    if (!(SETTING_KEYS as string[]).includes(r.key)) continue;
    try {
      const v = JSON.parse(r.value_json) as never;
      const k = r.key as keyof Settings;
      // Lists merge, so a new default list still shows on an older site.
      if (k === "lists") {
        for (const kind of TERM_KINDS) if ((v as Settings["lists"])[kind]) s.lists[kind] = (v as Settings["lists"])[kind];
      } else (s as unknown as Record<string, unknown>)[k] = v;
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

/* List values */

type TermRow = { id: string; kind: TermKind; name: string; sort_order: number; is_hidden: number };
const toTerm = (r: TermRow): Term => ({ id: r.id, kind: r.kind, name: r.name, sortOrder: r.sort_order, isHidden: r.is_hidden === 1 });

export async function listAllTerms(env: Env): Promise<Term[]> {
  const { results } = await env.DB.prepare("SELECT id, kind, name, sort_order, is_hidden FROM library_terms ORDER BY kind, sort_order, name").all<TermRow>();
  return results.map(toTerm);
}

async function termOr404(env: Env, id: string): Promise<TermRow> {
  const r = await env.DB.prepare("SELECT id, kind, name, sort_order, is_hidden FROM library_terms WHERE id = ?").bind(id).first<TermRow>();
  if (!r) throw new HttpError(404, "That list value does not exist. Reload the page.");
  return r;
}

async function nameTaken(env: Env, kind: TermKind, name: string, exceptId: string | null): Promise<boolean> {
  const r = await env.DB.prepare("SELECT id FROM library_terms WHERE kind = ? AND lower(name) = lower(?) AND id != ?").bind(kind, name, exceptId ?? "").first();
  return !!r;
}

export async function addTerm(env: Env, kind: TermKind, rawName: unknown): Promise<Term> {
  const name = cleanTermName(rawName);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), -1) AS top FROM library_terms WHERE kind = ?").bind(kind).first<{ n: number; top: number }>();
  if ((count?.n ?? 0) >= MAX_TERMS_PER_KIND) throw new HttpError(400, `A list can hold ${MAX_TERMS_PER_KIND} values or fewer. Hide or rename one instead.`);
  if (await nameTaken(env, kind, name, null)) throw new HttpError(409, `The list already has "${name}".`);
  const now = nowIso();
  const id = newId();
  const sort = (count?.top ?? -1) + 1;
  await env.DB.prepare("INSERT INTO library_terms (id, kind, name, sort_order, is_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
    .bind(id, kind, name, sort, now, now)
    .run();
  return { id, kind, name, sortOrder: sort, isHidden: false };
}

/** Renames, hides or shows, or moves a list value one place up or down. */
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
    const { results } = await env.DB.prepare("SELECT id FROM library_terms WHERE kind = ? ORDER BY sort_order, name").bind(t.kind).all<{ id: string }>();
    const i = results.findIndex((r) => r.id === id);
    const j = b.move === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= results.length) return;
    const order = results.map((r) => r.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    await env.DB.batch(order.map((tid, n) => env.DB.prepare("UPDATE library_terms SET sort_order = ?, updated_at = ? WHERE id = ?").bind(n, now, tid)));
  }
}

/** Only ids of list values that exist. */
async function knownTermIds(env: Env, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const all = new Set((await listAllTerms(env)).map((t) => t.id));
  return ids.filter((id) => all.has(id));
}

/* Resources */

type ResourceRow = {
  id: string;
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

const SELECT = `SELECT r.id, r.format, r.title, r.summary, r.body, r.source_url, r.image_url, r.site_name, r.video_provider, r.video_ref,
    r.file_key, r.file_name, r.file_type, r.file_size, r.status, r.is_featured, r.origin, a.name AS automation_name,
    r.published_at, r.created_by, r.created_at, r.updated_at,
    (SELECT group_concat(t.term_id) FROM library_resource_terms t WHERE t.resource_id = r.id) AS term_ids
  FROM library_resources r LEFT JOIN library_automations a ON a.id = r.automation_id`;

const toResource = (r: ResourceRow): Resource => ({
  id: r.id,
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

export async function resourceOr404(env: Env, id: string): Promise<Resource> {
  const r = await getResource(env, id);
  if (!r) throw new HttpError(404, "That resource is not in the library. It may have been deleted.");
  return r;
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

/** Published resources for readers. Featured ones come first when sorted by date. */
export async function publishedResources(env: Env, f: ReaderFilter = {}): Promise<Resource[]> {
  const { results } = await env.DB.prepare(`${SELECT} WHERE r.status = 'published' ORDER BY r.published_at DESC LIMIT ?`).bind(MAX_RESOURCES).all<ResourceRow>();
  let items = results.map(toResource);
  if (f.formats?.length) items = items.filter((r) => f.formats!.includes(r.format));
  if (f.terms) items = items.filter((r) => hasTerms(r.termIds, f.terms!));
  if (f.q) items = items.filter((r) => matches([r.title, r.summary, r.body, r.siteName].join(" "), f.q!));
  if (f.sort === "title") items.sort((a, b) => a.title.localeCompare(b.title));
  else items.sort((a, b) => Number(b.featured) - Number(a.featured) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return items;
}

const TAB_WHERE: Record<ManageTab, string> = {
  review: "r.status = 'draft' AND r.origin != 'person'",
  drafts: "r.status = 'draft' AND r.origin = 'person'",
  published: "r.status = 'published'",
  archived: "r.status = 'archived'"
};

export async function manageList(env: Env, tab: ManageTab, q = ""): Promise<Resource[]> {
  const { results } = await env.DB.prepare(`${SELECT} WHERE ${TAB_WHERE[tab]} ORDER BY r.updated_at DESC LIMIT ?`).bind(MAX_RESOURCES).all<ResourceRow>();
  const items = results.map(toResource);
  return q ? items.filter((r) => matches([r.title, r.summary, r.siteName].join(" "), q)) : items;
}

export async function manageCounts(env: Env): Promise<ManageCounts> {
  const r = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'draft' AND origin != 'person' THEN 1 ELSE 0 END) AS review,
       SUM(CASE WHEN status = 'draft' AND origin = 'person' THEN 1 ELSE 0 END) AS drafts,
       SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
     FROM library_resources`
  ).first<Record<keyof ManageCounts, number | null>>();
  return { review: r?.review ?? 0, drafts: r?.drafts ?? 0, published: r?.published ?? 0, archived: r?.archived ?? 0 };
}

/** What the server adds to a resource beyond the editable fields. */
export interface ResourceExtra {
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

export async function createResource(env: Env, f: ResourceFields, x: ResourceExtra, userId: string | null): Promise<string> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM library_resources").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_RESOURCES) throw new HttpError(400, `The library holds ${MAX_RESOURCES} resources, the most it can. Delete old ones first.`);
  const id = newId();
  const now = nowIso();
  const status = x.status ?? "draft";
  const termIds = await knownTermIds(env, f.termIds);
  const video = videoFields(f, !!x.file);
  if (status === "published") {
    const problem = publishProblem({ ...f, hasFile: !!x.file });
    if (problem) throw new HttpError(400, problem);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO library_resources (id, format, title, summary, body, source_url, image_url, site_name, video_provider, video_ref,
         file_key, file_name, file_type, file_size, extracted_text, status, is_featured, origin, automation_id, published_at,
         created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
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
      f.featured ? 1 : 0,
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

export async function saveResource(env: Env, id: string, f: ResourceFields, userId: string): Promise<void> {
  const before = await resourceOr404(env, id);
  if (before.hasFile && f.format !== before.format && (f.format === "article" || f.format === "link")) {
    throw new HttpError(400, "This resource has an uploaded file. Keep it a document or a video, or add the file as a new resource.");
  }
  if (before.status === "published") {
    const problem = publishProblem({ ...f, hasFile: before.hasFile });
    if (problem) throw new HttpError(400, problem);
  }
  const termIds = await knownTermIds(env, f.termIds);
  const video = videoFields(f, before.hasFile);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE library_resources SET format = ?, title = ?, summary = ?, body = ?, source_url = ?, image_url = ?, site_name = ?,
         video_provider = ?, video_ref = ?, is_featured = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(f.format, f.title, f.summary, f.body, f.sourceUrl, f.imageUrl, f.siteName || siteOf(f.sourceUrl), video.provider, video.ref, f.featured ? 1 : 0, userId, now, id),
    env.DB.prepare("DELETE FROM library_resource_terms WHERE resource_id = ?").bind(id),
    ...termIds.map((t) => env.DB.prepare("INSERT INTO library_resource_terms (resource_id, term_id) VALUES (?, ?)").bind(id, t))
  ]);
  await rebuildChunks(env, id);
}

export type StatusAction = "publish" | "unpublish" | "archive" | "restore";
export const STATUS_ACTIONS: readonly StatusAction[] = ["publish", "unpublish", "archive", "restore"];

/** Publish, take back to draft, archive or restore. With review on, a person's own resource needs another manager to publish it. */
export async function changeStatus(env: Env, id: string, action: StatusAction, s: Settings, userId: string): Promise<void> {
  const r = await resourceOr404(env, id);
  const now = nowIso();
  let next: Status;
  if (action === "publish") {
    const problem = publishProblem(r);
    if (problem) throw new HttpError(400, problem);
    if (s.reviewOn && r.origin === "person" && r.createdBy === userId) {
      throw new HttpError(403, "Review before publish is on. Another manager must publish a resource that you added.");
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
export async function deleteResource(env: Env, id: string): Promise<void> {
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

/** The Ask index of all published resources: one row per chunk, with the resource's title and format. */
export async function publishedChunks(env: Env, onlyId?: string): Promise<Array<{ resourceId: string; seq: number; text: string; title: string; format: Format; sourceUrl: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT c.resource_id, c.seq, c.text, r.title, r.format, r.source_url FROM library_chunks c
     JOIN library_resources r ON r.id = c.resource_id
     WHERE r.status = 'published' ${onlyId ? "AND r.id = ?" : ""}
     ORDER BY r.published_at DESC, c.seq LIMIT 50000`
  )
    .bind(...(onlyId ? [onlyId] : []))
    .all<{ resource_id: string; seq: number; text: string; title: string; format: Format; source_url: string }>();
  return results.map((r) => ({ resourceId: r.resource_id, seq: r.seq, text: r.text, title: r.title, format: r.format, sourceUrl: r.source_url }));
}

/** A resource with the same source link, so one link is not added twice. */
export async function resourceByUrl(env: Env, url: string): Promise<string | null> {
  if (!url) return null;
  const r = await env.DB.prepare("SELECT id FROM library_resources WHERE source_url = ? LIMIT 1").bind(url).first<{ id: string }>();
  return r?.id ?? null;
}
