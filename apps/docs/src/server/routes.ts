import { Hono, type Context } from "hono";
import {
  HttpError,
  acceptLive,
  appName,
  appUrl,
  assertLiveRequest,
  authSecret,
  deletePrefix,
  hasPermission,
  markChanged,
  newId,
  nowIso,
  oneOf,
  openSecret,
  randomToken,
  readJson,
  requirePermission,
  requireUser,
  sealSecret,
  sha256Hex,
  text,
  type AppEnv,
  type Env
} from "@openact/core/server";
import { ContentError, EMPTY_DOC, sanitizeDoc } from "../shared/content";
import { CATEGORIES_MAX, FOLDERS_MAX, cleanName, cleanTagNames, folderMoveProblem } from "../shared/library";
import {
  CATEGORY_COLORS,
  CONTENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
  MARGINS,
  ORIENTATIONS,
  PAGE_SIZES,
  SHARE_PREFIX,
  TITLE_MAX,
  fileSrc,
  sniffImage,
  type Category,
  type CategoryColor,
  type DocDetail,
  type DocNode,
  type DocSummary,
  type Folder,
  type Library,
  type Margin,
  type Orientation,
  type PageSize,
  type Tag
} from "../shared/types";
import { paperHeaders, paperPageHtml } from "./page-html";
import { AiRequestError, buildPrompt, readAiRequest } from "../shared/ai";
import { aiSetup, startAiStream } from "./ai";
import type { DocsEnv } from "./room";

/*
 * The Docs API, under /api/apps/docs.
 * Docs belong to a company. Every route checks a Docs permission with requirePermission(),
 * which also checks that the person is in the company and that Docs is on for the company and the site.
 *   docs.view      read docs and print them
 *   docs.edit      make, change and delete docs, and tag them
 *   docs.organize  make, rename, move and delete folders, categories and tags
 *   docs.share     make and turn off share links
 *   docs.ai        use AI writing help, when the company turned it on
 */

export const DOC_ROOM = "docs-doc";
export const LIBRARY_ROOM = "docs-library";
export const SHARE_PURPOSE = "docs-share";

export interface DocRow {
  id: string;
  company_id: string;
  folder_id: string | null;
  category_id: string | null;
  title: string;
  content: string;
  page_size: PageSize;
  orientation: Orientation;
  margin: Margin;
  rev: number;
  updated_by: string | null;
  updated_at: string;
}

const DOC_COLUMNS = "id, company_id, folder_id, category_id, title, content, page_size, orientation, margin, rev, updated_by, updated_at";

export async function loadDoc(env: Env, id: string): Promise<DocRow> {
  const row = await env.DB.prepare(`SELECT ${DOC_COLUMNS} FROM docs_docs WHERE id = ?`).bind(id).first<DocRow>();
  if (!row) throw new HttpError(404, "This doc does not exist. Someone may have deleted it.");
  return row;
}

/** A statement that raises the library's revision, so open pages load the lists again. */
function bumpLibrary(env: Env, companyId: string): D1PreparedStatement {
  markChanged(LIBRARY_ROOM, companyId);
  return env.DB.prepare("INSERT INTO docs_library (company_id, rev) VALUES (?, 1) ON CONFLICT (company_id) DO UPDATE SET rev = rev + 1").bind(companyId);
}

const displayName = (name: string | null, email: string | null) => name?.trim() || email?.split("@")[0] || null;

export function parseContent(raw: string): DocNode {
  try {
    return sanitizeDoc(JSON.parse(raw));
  } catch {
    return structuredClone(EMPTY_DOC);
  }
}

function problem(r: { name: string } | { problem: string }): string {
  if ("problem" in r) throw new HttpError(400, r.problem);
  return r.name;
}

async function loadFolders(env: Env, companyId: string): Promise<Folder[]> {
  const rows = await env.DB.prepare("SELECT id, parent_id, name FROM docs_folders WHERE company_id = ?")
    .bind(companyId)
    .all<{ id: string; parent_id: string | null; name: string }>();
  return rows.results.map((r) => ({ id: r.id, parentId: r.parent_id, name: r.name }));
}

/** Checks that a folder id belongs to the company. null stays null (no folder). */
async function companyFolder(env: Env, companyId: string, v: unknown): Promise<string | null> {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "string") throw new HttpError(400, "Folder must be a folder id or null.");
  const row = await env.DB.prepare("SELECT id FROM docs_folders WHERE id = ? AND company_id = ?").bind(v, companyId).first();
  if (!row) throw new HttpError(400, "That folder does not exist. Load the page again.");
  return v;
}

async function companyCategory(env: Env, companyId: string, v: unknown): Promise<string | null> {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "string") throw new HttpError(400, "Category must be a category id or null.");
  const row = await env.DB.prepare("SELECT id FROM docs_categories WHERE id = ? AND company_id = ?").bind(v, companyId).first();
  if (!row) throw new HttpError(400, "That category does not exist. Load the page again.");
  return v;
}

/**
 * Statements that set a doc's tags to these names. A name that is new makes a tag.
 * The inserts match names without regard to case, and two people who make the same new tag at once get one tag.
 */
function setTagStatements(env: Env, companyId: string, docId: string, names: string[]): D1PreparedStatement[] {
  const iso = nowIso();
  const stmts: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM docs_doc_tags WHERE doc_id = ?").bind(docId)];
  for (const n of names) {
    stmts.push(
      env.DB.prepare("INSERT INTO docs_tags (id, company_id, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(newId(), companyId, n, iso),
      env.DB.prepare("INSERT OR IGNORE INTO docs_doc_tags (doc_id, tag_id) SELECT ?, id FROM docs_tags WHERE company_id = ? AND name = ? COLLATE NOCASE").bind(
        docId,
        companyId,
        n
      )
    );
  }
  return stmts;
}

async function shareUrl(c: Context<AppEnv>, docId: string): Promise<string | null> {
  const row = await c.env.DB.prepare("SELECT token_box FROM docs_shares WHERE doc_id = ?").bind(docId).first<{ token_box: string }>();
  if (!row) return null;
  const token = await openSecret(authSecret(c.env, c.req.url), SHARE_PURPOSE, docId, row.token_box);
  // A token that does not decrypt (AUTH_SECRET changed) still works, but nobody can copy it again. Make a new link.
  return token ? `${appUrl(c)}${SHARE_PREFIX}${token}` : null;
}

async function docTagIds(env: Env, docId: string): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT tag_id FROM docs_doc_tags WHERE doc_id = ?").bind(docId).all<{ tag_id: string }>();
  return rows.results.map((r) => r.tag_id);
}

export const docsRoutes = new Hono<AppEnv>();

/** True when a company owner or admin turned on AI writing help in Docs. Off by default. */
export async function aiEnabled(env: Env, companyId: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT ai_enabled FROM docs_settings WHERE company_id = ?").bind(companyId).first<{ ai_enabled: number }>();
    return row?.ai_enabled === 1;
  } catch (e) {
    // Before migration docs_0002 runs, AI stays off.
    if (/no such table/i.test(String(e))) return false;
    throw e;
  }
}

/* The library: folders, categories, tags and doc summaries of one company */

docsRoutes.get("/companies/:companyId/library", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "docs.view");
  const [rev, folders, cats, tags, docs, docTags, can] = await Promise.all([
    c.env.DB.prepare("SELECT rev FROM docs_library WHERE company_id = ?").bind(companyId).first<{ rev: number }>(),
    loadFolders(c.env, companyId),
    c.env.DB.prepare("SELECT id, name, color FROM docs_categories WHERE company_id = ? ORDER BY position, name").bind(companyId).all<Category>(),
    c.env.DB.prepare("SELECT id, name FROM docs_tags WHERE company_id = ? ORDER BY name COLLATE NOCASE").bind(companyId).all<Tag>(),
    c.env.DB.prepare(
      `SELECT d.id, d.title, d.folder_id, d.category_id, d.page_size, d.updated_at, u.name AS u_name, u.email AS u_email, s.doc_id IS NOT NULL AS shared
       FROM docs_docs d
       LEFT JOIN users u ON u.id = d.updated_by
       LEFT JOIN docs_shares s ON s.doc_id = d.id
       WHERE d.company_id = ?
       ORDER BY d.updated_at DESC`
    )
      .bind(companyId)
      .all<{
        id: string;
        title: string;
        folder_id: string | null;
        category_id: string | null;
        page_size: PageSize;
        updated_at: string;
        u_name: string | null;
        u_email: string | null;
        shared: number;
      }>(),
    c.env.DB.prepare("SELECT dt.doc_id, dt.tag_id FROM docs_doc_tags dt JOIN docs_docs d ON d.id = dt.doc_id WHERE d.company_id = ?")
      .bind(companyId)
      .all<{ doc_id: string; tag_id: string }>(),
    Promise.all(["docs.edit", "docs.organize", "docs.share"].map((p) => hasPermission(c.env, companyId, user.id, p)))
  ]);
  const tagsByDoc = new Map<string, string[]>();
  for (const r of docTags.results) tagsByDoc.set(r.doc_id, [...(tagsByDoc.get(r.doc_id) ?? []), r.tag_id]);
  const summaries: DocSummary[] = docs.results.map((r) => ({
    id: r.id,
    title: r.title,
    folderId: r.folder_id,
    categoryId: r.category_id,
    tagIds: tagsByDoc.get(r.id) ?? [],
    pageSize: r.page_size,
    shared: !!r.shared,
    updatedAt: r.updated_at,
    updatedByName: displayName(r.u_name, r.u_email)
  }));
  const library: Library = {
    rev: rev?.rev ?? 0,
    folders,
    categories: cats.results.map((k) => ({ ...k, color: (CATEGORY_COLORS as readonly string[]).includes(k.color) ? k.color : "slate" })),
    tags: tags.results,
    docs: summaries,
    can: { edit: can[0]!, organize: can[1]!, share: can[2]! }
  };
  return c.json(library);
});

docsRoutes.get("/companies/:companyId/live", async (c) => {
  const user = requireUser(c);
  assertLiveRequest(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "docs.view");
  const row = await c.env.DB.prepare("SELECT rev FROM docs_library WHERE company_id = ?").bind(companyId).first<{ rev: number }>();
  return acceptLive(c, LIBRARY_ROOM, companyId, { userId: user.id, name: user.name || user.email.split("@")[0]! }, row?.rev ?? 0);
});

/* Docs */

docsRoutes.post("/companies/:companyId/docs", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "docs.edit");
  const body = await readJson(c);
  const title = text(body.title, "Title", { max: TITLE_MAX }) || "Untitled doc";
  const pageSize = body.pageSize === undefined ? "letter" : oneOf(body.pageSize, "Page size", PAGE_SIZES);
  const [folderId, categoryId] = await Promise.all([companyFolder(c.env, companyId, body.folderId), companyCategory(c.env, companyId, body.categoryId)]);
  const id = newId();
  const iso = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO docs_docs (id, company_id, folder_id, category_id, title, content, page_size, orientation, margin, rev, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'portrait', 'normal', 1, ?, ?, ?, ?)`
    ).bind(id, companyId, folderId, categoryId, title, JSON.stringify(EMPTY_DOC), pageSize, user.id, user.id, iso, iso),
    bumpLibrary(c.env, companyId)
  ]);
  return c.json({ id }, 201);
});

docsRoutes.get("/docs/:id", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.view");
  const [who, canEdit, canShare, shared, tagIds, canAi, aiOn, canComment] = await Promise.all([
    doc.updated_by ? c.env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(doc.updated_by).first<{ name: string; email: string }>() : null,
    hasPermission(c.env, doc.company_id, user.id, "docs.edit"),
    hasPermission(c.env, doc.company_id, user.id, "docs.share"),
    c.env.DB.prepare("SELECT 1 AS x FROM docs_shares WHERE doc_id = ?").bind(doc.id).first(),
    docTagIds(c.env, doc.id),
    hasPermission(c.env, doc.company_id, user.id, "docs.ai"),
    aiEnabled(c.env, doc.company_id),
    hasPermission(c.env, doc.company_id, user.id, "docs.comment")
  ]);
  const detail: DocDetail = {
    id: doc.id,
    companyId: doc.company_id,
    title: doc.title,
    folderId: doc.folder_id,
    categoryId: doc.category_id,
    tagIds,
    content: parseContent(doc.content),
    pageSize: doc.page_size,
    orientation: doc.orientation,
    margin: doc.margin,
    rev: doc.rev,
    updatedAt: doc.updated_at,
    updatedByName: who ? displayName(who.name, who.email) : null,
    canEdit,
    canShare,
    shareUrl: canShare && shared ? await shareUrl(c, doc.id) : null,
    shared: !!shared,
    canComment,
    collab: !!(c.env as DocsEnv).DOCS_ROOMS,
    ai: !aiOn ? "off" : canEdit && canAi ? "on" : "no_permission"
  };
  return c.json(detail);
});

/** The revision only, for pages that poll when live updates are down. */
docsRoutes.get("/docs/:id/rev", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.view");
  return c.json({ rev: doc.rev });
});

/**
 * Saves a doc. Body: { baseRev, title?, content?, pageSize?, orientation?, margin? }
 * baseRev is the rev the editor loaded. When someone else saved first, the save is refused with 409 and code "conflict".
 */
docsRoutes.patch("/docs/:id", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.edit");
  const body = await readJson(c);
  // Only content needs the rev check. The title and page settings can change while someone writes, for example in live editing.
  const checkRev = body.content !== undefined;
  if (checkRev && typeof body.baseRev !== "number") throw new HttpError(400, "baseRev is required. Load the doc again, then save.");
  if (checkRev && body.baseRev !== doc.rev)
    throw new HttpError(409, "Someone else saved this doc after you opened it. Load their version, then make your change again.", "conflict");

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.title !== undefined) {
    const title = text(body.title, "Title", { max: TITLE_MAX }) || "Untitled doc";
    sets.push("title = ?");
    binds.push(title);
  }
  if (body.content !== undefined) {
    let clean: DocNode;
    try {
      clean = sanitizeDoc(body.content);
    } catch (e) {
      if (e instanceof ContentError) throw new HttpError(400, e.message);
      throw e;
    }
    const json = JSON.stringify(clean);
    if (new TextEncoder().encode(json).length > CONTENT_MAX_BYTES) throw new HttpError(413, "The doc is too large to save. Split it into two docs.");
    sets.push("content = ?");
    binds.push(json);
  }
  if (body.pageSize !== undefined) (sets.push("page_size = ?"), binds.push(oneOf(body.pageSize, "Page size", PAGE_SIZES)));
  if (body.orientation !== undefined) (sets.push("orientation = ?"), binds.push(oneOf(body.orientation, "Orientation", ORIENTATIONS)));
  if (body.margin !== undefined) (sets.push("margin = ?"), binds.push(oneOf(body.margin, "Margins", MARGINS)));
  if (!sets.length) return c.json({ rev: doc.rev, updatedAt: doc.updated_at });

  const iso = nowIso();
  const stmts = [
    checkRev
      ? c.env.DB.prepare(`UPDATE docs_docs SET ${sets.join(", ")}, rev = rev + 1, updated_by = ?, updated_at = ? WHERE id = ? AND rev = ?`).bind(
          ...binds,
          user.id,
          iso,
          doc.id,
          doc.rev
        )
      : c.env.DB.prepare(`UPDATE docs_docs SET ${sets.join(", ")}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...binds, user.id, iso, doc.id),
    // The library lists titles and edit times, so every save refreshes open lists.
    bumpLibrary(c.env, doc.company_id)
  ];
  const res = await c.env.DB.batch(stmts);
  if (!res[0]!.meta.changes)
    throw new HttpError(409, "Someone else saved this doc at the same moment. Load their version, then make your change again.", "conflict");
  if (!checkRev) return c.json({ rev: doc.rev, updatedAt: iso });
  markChanged(DOC_ROOM, doc.id);
  return c.json({ rev: doc.rev + 1, updatedAt: iso });
});

/**
 * Files a doc: its folder, category and tags. Body: { folderId?, categoryId?, tags?: string[] }
 * Tags are names. A name that is new makes a new tag. This does not change the doc's content or its rev,
 * so it never clashes with someone who is writing in the doc.
 */
docsRoutes.patch("/docs/:id/meta", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.edit");
  const body = await readJson(c);
  const stmts: D1PreparedStatement[] = [];
  if (body.folderId !== undefined)
    stmts.push(c.env.DB.prepare("UPDATE docs_docs SET folder_id = ? WHERE id = ?").bind(await companyFolder(c.env, doc.company_id, body.folderId), doc.id));
  if (body.categoryId !== undefined)
    stmts.push(
      c.env.DB.prepare("UPDATE docs_docs SET category_id = ? WHERE id = ?").bind(await companyCategory(c.env, doc.company_id, body.categoryId), doc.id)
    );
  if (body.tags !== undefined) {
    const r = cleanTagNames(body.tags);
    if ("problem" in r) throw new HttpError(400, r.problem);
    stmts.push(...setTagStatements(c.env, doc.company_id, doc.id, r.names));
  }
  if (stmts.length) {
    stmts.push(bumpLibrary(c.env, doc.company_id));
    await c.env.DB.batch(stmts);
  }
  return c.json({ ok: true, tagIds: await docTagIds(c.env, doc.id) });
});

docsRoutes.delete("/docs/:id", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.edit");
  await deletePrefix(c.env.FILES, `docs/${doc.company_id}/${doc.id}/`);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM docs_files WHERE doc_id = ?").bind(doc.id),
    c.env.DB.prepare("DELETE FROM docs_docs WHERE id = ?").bind(doc.id),
    bumpLibrary(c.env, doc.company_id)
  ]);
  markChanged(DOC_ROOM, doc.id);
  return c.json({ ok: true });
});

/* Folders */

docsRoutes.post("/companies/:companyId/folders", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "docs.organize");
  const body = await readJson(c);
  const name = problem(cleanName(body.name, "Folder"));
  const folders = await loadFolders(c.env, companyId);
  if (folders.length >= FOLDERS_MAX) throw new HttpError(400, `A library can have up to ${FOLDERS_MAX} folders. Delete folders you do not use.`);
  const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
  const p = folderMoveProblem(folders, null, parentId);
  if (p) throw new HttpError(400, p);
  const id = newId();
  const iso = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO docs_folders (id, company_id, parent_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      companyId,
      parentId,
      name,
      user.id,
      iso,
      iso
    ),
    bumpLibrary(c.env, companyId)
  ]);
  return c.json({ id }, 201);
});

async function loadFolder(env: Env, id: string): Promise<{ id: string; company_id: string; parent_id: string | null }> {
  const row = await env.DB.prepare("SELECT id, company_id, parent_id FROM docs_folders WHERE id = ?")
    .bind(id)
    .first<{ id: string; company_id: string; parent_id: string | null }>();
  if (!row) throw new HttpError(404, "This folder does not exist. Someone may have deleted it.");
  return row;
}

/** Renames or moves a folder. Body: { name?, parentId? } (parentId null moves it to the top level) */
docsRoutes.patch("/folders/:id", async (c) => {
  const user = requireUser(c);
  const folder = await loadFolder(c.env, c.req.param("id"));
  await requirePermission(c.env, folder.company_id, user.id, "docs.organize");
  const body = await readJson(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) (sets.push("name = ?"), binds.push(problem(cleanName(body.name, "Folder"))));
  if (body.parentId !== undefined) {
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
    const p = folderMoveProblem(await loadFolders(c.env, folder.company_id), folder.id, parentId);
    if (p) throw new HttpError(400, p);
    (sets.push("parent_id = ?"), binds.push(parentId));
  }
  if (!sets.length) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE docs_folders SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...binds, nowIso(), folder.id),
    bumpLibrary(c.env, folder.company_id)
  ]);
  return c.json({ ok: true });
});

/** Deletes an empty folder. Move or delete its docs and folders first, so nothing is lost by mistake. */
docsRoutes.delete("/folders/:id", async (c) => {
  const user = requireUser(c);
  const folder = await loadFolder(c.env, c.req.param("id"));
  await requirePermission(c.env, folder.company_id, user.id, "docs.organize");
  const [docs, kids] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM docs_docs WHERE folder_id = ?").bind(folder.id).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM docs_folders WHERE parent_id = ?").bind(folder.id).first<{ n: number }>()
  ]);
  if ((docs?.n ?? 0) > 0 || (kids?.n ?? 0) > 0)
    throw new HttpError(400, "This folder is not empty. Move or delete its docs and folders first.", "folder_not_empty");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM docs_folders WHERE id = ?").bind(folder.id), bumpLibrary(c.env, folder.company_id)]);
  return c.json({ ok: true });
});

/* Categories */

docsRoutes.post("/companies/:companyId/categories", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "docs.organize");
  const body = await readJson(c);
  const name = problem(cleanName(body.name, "Category"));
  const color: CategoryColor = body.color === undefined ? "slate" : oneOf(body.color, "Color", CATEGORY_COLORS);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM docs_categories WHERE company_id = ?")
    .bind(companyId)
    .first<{ n: number; pos: number }>();
  if ((count?.n ?? 0) >= CATEGORIES_MAX) throw new HttpError(400, `A library can have up to ${CATEGORIES_MAX} categories.`);
  const id = newId();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO docs_categories (id, company_id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        id,
        companyId,
        name,
        color,
        (count?.pos ?? 0) + 1,
        nowIso()
      ),
      bumpLibrary(c.env, companyId)
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, `There is already a category named "${name}".`);
    throw e;
  }
  return c.json({ id }, 201);
});

async function loadCategory(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT id, company_id FROM docs_categories WHERE id = ?").bind(id).first<{ id: string; company_id: string }>();
  if (!row) throw new HttpError(404, "This category does not exist. Someone may have deleted it.");
  return row;
}

docsRoutes.patch("/categories/:id", async (c) => {
  const user = requireUser(c);
  const cat = await loadCategory(c.env, c.req.param("id"));
  await requirePermission(c.env, cat.company_id, user.id, "docs.organize");
  const body = await readJson(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) (sets.push("name = ?"), binds.push(problem(cleanName(body.name, "Category"))));
  if (body.color !== undefined) (sets.push("color = ?"), binds.push(oneOf(body.color, "Color", CATEGORY_COLORS)));
  if (!sets.length) return c.json({ ok: true });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE docs_categories SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, cat.id),
      bumpLibrary(c.env, cat.company_id)
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, "There is already a category with that name.");
    throw e;
  }
  return c.json({ ok: true });
});

/** Deletes a category. Its docs stay, with no category. */
docsRoutes.delete("/categories/:id", async (c) => {
  const user = requireUser(c);
  const cat = await loadCategory(c.env, c.req.param("id"));
  await requirePermission(c.env, cat.company_id, user.id, "docs.organize");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM docs_categories WHERE id = ?").bind(cat.id), bumpLibrary(c.env, cat.company_id)]);
  return c.json({ ok: true });
});

/* Tags. Editors make tags by typing new names on a doc. Organizers rename and delete them. */

async function loadTag(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT id, company_id FROM docs_tags WHERE id = ?").bind(id).first<{ id: string; company_id: string }>();
  if (!row) throw new HttpError(404, "This tag does not exist. Someone may have deleted it.");
  return row;
}

docsRoutes.patch("/tags/:id", async (c) => {
  const user = requireUser(c);
  const tag = await loadTag(c.env, c.req.param("id"));
  await requirePermission(c.env, tag.company_id, user.id, "docs.organize");
  const body = await readJson(c);
  const name = problem(cleanName(body.name, "Tag"));
  try {
    await c.env.DB.batch([c.env.DB.prepare("UPDATE docs_tags SET name = ? WHERE id = ?").bind(name, tag.id), bumpLibrary(c.env, tag.company_id)]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, `There is already a tag named "${name}".`);
    throw e;
  }
  return c.json({ ok: true });
});

/** Deletes a tag and takes it off every doc. */
docsRoutes.delete("/tags/:id", async (c) => {
  const user = requireUser(c);
  const tag = await loadTag(c.env, c.req.param("id"));
  await requirePermission(c.env, tag.company_id, user.id, "docs.organize");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM docs_tags WHERE id = ?").bind(tag.id), bumpLibrary(c.env, tag.company_id)]);
  return c.json({ ok: true });
});

/* Share links */

async function requireShare(env: Env, doc: DocRow, userId: string) {
  await requirePermission(env, doc.company_id, userId, "docs.share");
}

/** Makes a new share link. An older link stops working. */
docsRoutes.post("/docs/:id/share", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requireShare(c.env, doc, user.id);
  const token = randomToken(32);
  const [hash, box] = await Promise.all([sha256Hex(token), sealSecret(authSecret(c.env, c.req.url), SHARE_PURPOSE, doc.id, token)]);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO docs_shares (doc_id, token_hash, token_box, created_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (doc_id) DO UPDATE SET token_hash = excluded.token_hash, token_box = excluded.token_box,
         created_by = excluded.created_by, created_at = excluded.created_at`
    ).bind(doc.id, hash, box, user.id, nowIso()),
    bumpLibrary(c.env, doc.company_id)
  ]);
  return c.json({ shareUrl: `${appUrl(c)}${SHARE_PREFIX}${token}` });
});

/** Turns the share link off. The link stops working at once. */
docsRoutes.delete("/docs/:id/share", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requireShare(c.env, doc, user.id);
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM docs_shares WHERE doc_id = ?").bind(doc.id), bumpLibrary(c.env, doc.company_id)]);
  return c.json({ ok: true });
});

/* Images */

docsRoutes.post("/docs/:id/files", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.edit");
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "Choose an image to upload.");
  if (file.size === 0) throw new HttpError(400, "The image is empty.");
  if (file.size > IMAGE_MAX_BYTES) throw new HttpError(413, "The image is too large. The limit is 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) throw new HttpError(400, "Use a PNG, JPEG, WebP or GIF image.");
  const id = newId();
  const key = `docs/${doc.company_id}/${doc.id}/${id}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare("INSERT INTO docs_files (id, company_id, doc_id, r2_key, content_type, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, doc.company_id, doc.id, key, type, bytes.length, user.id, nowIso())
    .run();
  return c.json({ id, src: fileSrc(id) }, 201);
});

export interface FileRow {
  id: string;
  doc_id: string;
  r2_key: string;
  content_type: string;
  size: number;
}

/** Sends an image. Images never run code: a strict CSP, a checked type and nosniff. */
export async function sendImage(env: Env, file: FileRow): Promise<Response> {
  const obj = await env.FILES.get(file.r2_key);
  if (!obj) throw new HttpError(404, "The image is missing from storage.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": file.content_type,
      "Content-Length": String(file.size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      // The file id never changes its bytes, but access can change, so the browser keeps it only privately and briefly.
      "Cache-Control": "private, max-age=300"
    }
  });
}

docsRoutes.get("/files/:fileId", async (c) => {
  const user = requireUser(c);
  const file = await c.env.DB.prepare("SELECT id, doc_id, r2_key, content_type, size FROM docs_files WHERE id = ?")
    .bind(c.req.param("fileId"))
    .first<FileRow>();
  if (!file) throw new HttpError(404, "This image does not exist.");
  const doc = await loadDoc(c.env, file.doc_id);
  await requirePermission(c.env, doc.company_id, user.id, "docs.view");
  return sendImage(c.env, file);
});

/* Print and live updates */

/** The doc on paper, for printing or saving as PDF. Opens the print dialog when it is ready. */
docsRoutes.get("/docs/:id/print", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.view");
  const nonce = randomToken(16);
  const html = paperPageHtml({
    title: doc.title,
    siteName: appName(c.env),
    doc: parseContent(doc.content),
    settings: { pageSize: doc.page_size, orientation: doc.orientation, margin: doc.margin },
    updatedAt: doc.updated_at,
    imageUrl: (src) => src,
    nonce,
    mode: "print"
  });
  return new Response(html, { headers: paperHeaders(nonce) });
});

docsRoutes.get("/docs/:id/live", async (c) => {
  const user = requireUser(c);
  assertLiveRequest(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.view");
  return acceptLive(c, DOC_ROOM, doc.id, { userId: user.id, name: user.name || user.email.split("@")[0]! }, doc.rev);
});

/* AI writing help */

/**
 * Streams AI text for a selection. Body: { action, text, before?, after?, tone?, language?, prompt? }
 * The answer is server-sent events: "data: {"t": "..."}" for each part, then "event: done", or "event: error".
 * The web app shows the text as a preview. Nothing changes in the doc until the person accepts it.
 */
docsRoutes.post("/docs/:id/ai", async (c) => {
  const user = requireUser(c);
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.edit");
  await requirePermission(c.env, doc.company_id, user.id, "docs.ai");
  if (!(await aiEnabled(c.env, doc.company_id)))
    throw new HttpError(
      403,
      "AI writing help is off for this company. A company owner or admin can turn it on in Company settings, on the Docs tab.",
      "ai_off"
    );
  let req;
  try {
    req = readAiRequest(await readJson(c));
  } catch (e) {
    if (e instanceof AiRequestError) throw new HttpError(400, e.message);
    throw e;
  }
  const setup = await aiSetup(c.env, doc.company_id);
  const label = req.action === "translate" ? req.language : req.action === "tone" ? req.tone : req.action;
  const parts = await startAiStream(c.env, setup, buildPrompt(req), `[${label}] ${req.text}`);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        for await (const t of parts) ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ t })}\n\n`));
        ctrl.enqueue(enc.encode("event: done\ndata: {}\n\n"));
      } catch (e) {
        console.error("[openact] docs AI stream failed:", e);
        ctrl.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ message: "The AI stopped before it finished. Try again." })}\n\n`));
      }
      ctrl.close();
    }
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
});

/* Live editing */

/**
 * Opens the live editing connection of a doc: /api/apps/docs/collab/<doc id> with Upgrade: websocket.
 * The y-websocket client in the browser connects here. Viewers get a read-only connection.
 */
docsRoutes.get("/collab/:id", async (c) => {
  const user = requireUser(c);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "Open this address with a WebSocket.");
  // Browsers send cookies with WebSocket requests from any site, so check the Origin before anything else.
  const origin = c.req.header("origin");
  if (!origin || origin !== new URL(c.req.url).origin) throw new HttpError(403, "Cross-site WebSocket requests are not allowed.");
  const rooms = (c.env as DocsEnv).DOCS_ROOMS;
  if (!rooms) throw new HttpError(501, "Live editing is not set up on this deploy. Docs saves changes the usual way.");
  const doc = await loadDoc(c.env, c.req.param("id"));
  await requirePermission(c.env, doc.company_id, user.id, "docs.view");
  const canEdit = await hasPermission(c.env, doc.company_id, user.id, "docs.edit");
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-openact-user", user.id);
  headers.set("x-openact-name", encodeURIComponent(user.name || user.email.split("@")[0]!));
  headers.set("x-openact-can-edit", canEdit ? "1" : "0");
  headers.set("x-openact-doc", doc.id);
  headers.set("x-openact-company", doc.company_id);
  return rooms.get(rooms.idFromName(doc.id)).fetch(new Request(c.req.raw.url, { method: "GET", headers }));
});
