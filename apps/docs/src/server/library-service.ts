import { newId, nowIso, type Env } from "@openact/core/server";
import { EMPTY_DOC } from "../shared/content";
import { PDF_MAX_BYTES, TITLE_MAX, cleanFileName, sniffPdf, titleFromFileName } from "../shared/types";
import { bumpLibrary } from "./routes";

/*
 * The Docs library service, for other apps: appService<DocsLibraryService>("docs", "library").
 * eSign uses it to send a PDF from the library and to save signed PDFs back to it.
 *
 * These functions do not check access. The calling app checks that Docs is on for the company,
 * and that the person has docs.view (to read) or docs.edit (to save), before it calls them.
 */

export interface LibraryPdf {
  id: string;
  title: string;
  name: string;
  size: number;
  folder: string | null;
  updatedAt: string;
}

export interface LibraryFolder {
  id: string;
  /** The folder path, such as "Clients / Acme". */
  path: string;
}

export interface DocsLibraryService {
  listPdfs(env: Env, companyId: string, opts?: { query?: string; limit?: number }): Promise<LibraryPdf[]>;
  readPdf(env: Env, companyId: string, docId: string): Promise<{ title: string; name: string; bytes: Uint8Array } | null>;
  folders(env: Env, companyId: string): Promise<LibraryFolder[]>;
  savePdf(
    env: Env,
    p: { companyId: string; userId: string | null; title: string; name: string; bytes: Uint8Array; folderId: string | null }
  ): Promise<{ id: string; path: string }>;
}

async function folderPaths(env: Env, companyId: string): Promise<Map<string, string>> {
  const rows = await env.DB.prepare("SELECT id, parent_id, name FROM docs_folders WHERE company_id = ?")
    .bind(companyId)
    .all<{ id: string; parent_id: string | null; name: string }>();
  const byId = new Map(rows.results.map((r) => [r.id, r]));
  const paths = new Map<string, string>();
  for (const r of rows.results) {
    const names: string[] = [];
    let at: typeof r | undefined = r;
    // Folders nest up to 5 levels. The limit also stops a loop in bad data.
    for (let i = 0; at && i < 8; i++) {
      names.unshift(at.name);
      at = at.parent_id ? byId.get(at.parent_id) : undefined;
    }
    paths.set(r.id, names.join(" / "));
  }
  return paths;
}

export const docsLibrary: DocsLibraryService = {
  async listPdfs(env, companyId, opts = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const q = (opts.query ?? "").trim().slice(0, 100);
    const rows = await env.DB.prepare(
      `SELECT d.id, d.title, d.folder_id, d.updated_at, f.name, f.size
       FROM docs_docs d JOIN docs_files f ON f.id = d.file_id AND f.doc_id = d.id
       WHERE d.company_id = ? AND d.kind = 'pdf' ${q ? "AND d.title LIKE ? ESCAPE '\\'" : ""}
       ORDER BY d.updated_at DESC LIMIT ?`
    )
      .bind(...(q ? [companyId, `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`, limit] : [companyId, limit]))
      .all<{ id: string; title: string; folder_id: string | null; updated_at: string; name: string | null; size: number }>();
    const paths = rows.results.some((r) => r.folder_id) ? await folderPaths(env, companyId) : new Map<string, string>();
    return rows.results.map((r) => ({
      id: r.id,
      title: r.title,
      name: r.name || "document.pdf",
      size: r.size,
      folder: r.folder_id ? (paths.get(r.folder_id) ?? null) : null,
      updatedAt: r.updated_at
    }));
  },

  async readPdf(env, companyId, docId) {
    const row = await env.DB.prepare(
      `SELECT d.title, f.name, f.r2_key FROM docs_docs d JOIN docs_files f ON f.id = d.file_id AND f.doc_id = d.id
       WHERE d.id = ? AND d.company_id = ? AND d.kind = 'pdf'`
    )
      .bind(docId, companyId)
      .first<{ title: string; name: string | null; r2_key: string }>();
    if (!row) return null;
    const obj = await env.FILES.get(row.r2_key);
    if (!obj) return null;
    return { title: row.title, name: row.name || "document.pdf", bytes: new Uint8Array(await obj.arrayBuffer()) };
  },

  async folders(env, companyId) {
    const paths = await folderPaths(env, companyId);
    return [...paths].map(([id, path]) => ({ id, path })).sort((a, b) => a.path.localeCompare(b.path));
  },

  async savePdf(env, p) {
    if (!sniffPdf(p.bytes)) throw new Error("savePdf: the bytes are not a PDF.");
    if (p.bytes.length > PDF_MAX_BYTES) throw new Error("savePdf: the PDF is over the Docs size limit.");
    let folderId = p.folderId;
    if (folderId) {
      const row = await env.DB.prepare("SELECT id FROM docs_folders WHERE id = ? AND company_id = ?").bind(folderId, p.companyId).first();
      // A deleted folder is not an error: the PDF goes to the top of the library.
      if (!row) folderId = null;
    }
    const name = cleanFileName(p.name);
    const title = p.title.trim().slice(0, TITLE_MAX) || titleFromFileName(name);
    const id = newId();
    const fileId = newId();
    const key = `docs/${p.companyId}/${id}/${fileId}`;
    const iso = nowIso();
    await env.FILES.put(key, p.bytes, { httpMetadata: { contentType: "application/pdf" } });
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO docs_docs (id, company_id, kind, file_id, folder_id, category_id, title, content, page_size, orientation, margin, rev, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, 'pdf', ?, ?, NULL, ?, ?, 'letter', 'portrait', 'normal', 1, ?, ?, ?, ?)`
        ).bind(id, p.companyId, fileId, folderId, title, JSON.stringify(EMPTY_DOC), p.userId, p.userId, iso, iso),
        env.DB.prepare(
          "INSERT INTO docs_files (id, company_id, doc_id, r2_key, content_type, size, name, uploaded_by, created_at) VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?)"
        ).bind(fileId, p.companyId, id, key, p.bytes.length, name, p.userId, iso),
        bumpLibrary(env, p.companyId)
      ]);
    } catch (e) {
      await env.FILES.delete(key);
      throw e;
    }
    return { id, path: `/a/docs/p/${id}` };
  }
};
