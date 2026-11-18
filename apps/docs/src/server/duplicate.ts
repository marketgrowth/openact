import type { CompanyCopyContext, Env } from "@openact/core/server";
import { FILE_SRC, fileSrc } from "../shared/types.ts";

/*
 * Duplicate company, Docs part: copies the library of a company. That is the folders, categories, tags, docs,
 * PDFs, doc images and the AI writing help setting.
 *
 * Comments, share links and who wrote what are not copied. The person who duplicates is the author of each copy.
 * Each image gets a new file, so the copy shows to the people of the new company, and its doc points at the new file.
 * A PDF copies only its current file.
 *
 * Imports only types and a pure module, so tests can run it on SQLite.
 */

type Row = Record<string, string | number | null>;

/** The value of a field of the current json_each row. */
const j = (field: string) => `json_extract(m.value, '$.${field}')`;

/** Points each image in saved doc JSON at its copied file. Returns the new JSON, or null when nothing changed. */
export function remapImages(content: string, files: ReadonlyMap<string, string>): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return null;
  }
  let changed = false;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown };
    if (n.type === "image" && n.attrs && typeof n.attrs.src === "string") {
      const m = FILE_SRC.exec(n.attrs.src);
      const next = m ? files.get(m[1]!) : undefined;
      if (next) {
        n.attrs.src = fileSrc(next);
        changed = true;
      }
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(doc);
  return changed ? JSON.stringify(doc) : null;
}

export async function duplicateDocs(env: Env, ctx: CompanyCopyContext) {
  const { fromId, toId, userId, now } = ctx;
  const [folders, categories, tags, docs, docTags, files, settings] = await env.DB.batch([
    env.DB.prepare("SELECT id, parent_id FROM docs_folders WHERE company_id = ?").bind(fromId),
    env.DB.prepare("SELECT id FROM docs_categories WHERE company_id = ?").bind(fromId),
    env.DB.prepare("SELECT id FROM docs_tags WHERE company_id = ?").bind(fromId),
    env.DB.prepare(
      "SELECT id, folder_id, category_id, kind, file_id, instr(content, '/api/apps/docs/files/') > 0 AS has_images FROM docs_docs WHERE company_id = ? ORDER BY created_at"
    ).bind(fromId),
    env.DB.prepare("SELECT dt.doc_id, dt.tag_id FROM docs_doc_tags dt JOIN docs_docs d ON d.id = dt.doc_id WHERE d.company_id = ?").bind(fromId),
    // Every image of a doc, and only the current file of a PDF.
    env.DB.prepare(
      `SELECT f.id, f.doc_id, f.r2_key FROM docs_files f JOIN docs_docs d ON d.id = f.doc_id
       WHERE d.company_id = ? AND (d.kind != 'pdf' OR f.id = d.file_id) ORDER BY f.created_at`
    ).bind(fromId),
    env.DB.prepare("SELECT ai_enabled FROM docs_settings WHERE company_id = ?").bind(fromId)
  ]);

  // Folders: parents before children, so each parent exists when its child goes in.
  const folderRows0 = folders!.results as Array<{ id: string; parent_id: string | null }>;
  const parentOf = new Map(folderRows0.map((f) => [f.id, f.parent_id]));
  const depth = (id: string): number => {
    let d = 0;
    for (let p = parentOf.get(id); p && d < 10; p = parentOf.get(p)) d++;
    return d;
  };
  const folderIds = new Map(folderRows0.map((f) => [f.id, ctx.newId()]));
  const folderRows: Row[] = [...folderRows0]
    .sort((a, b) => depth(a.id) - depth(b.id))
    .map((f) => ({ o: f.id, n: folderIds.get(f.id)!, p: f.parent_id ? (folderIds.get(f.parent_id) ?? null) : null }));

  const categoryIds = new Map((categories!.results as Array<{ id: string }>).map((c) => [c.id, ctx.newId()]));
  const tagIds = new Map((tags!.results as Array<{ id: string }>).map((t) => [t.id, ctx.newId()]));

  const docList = docs!.results as Array<{ id: string; folder_id: string | null; category_id: string | null; kind: string; file_id: string | null; has_images: number }>;
  const docIds = new Map(docList.map((d) => [d.id, ctx.newId()]));

  // Files: a new copy in R2 for each one. A file that is missing from storage is left out.
  const fileList = (files!.results as Array<{ id: string; doc_id: string; r2_key: string }>).map((f) => {
    const id = ctx.newId();
    const doc = docIds.get(f.doc_id)!;
    return { o: f.id, n: id, d: doc, k: `docs/${toId}/${doc}/${id}`, from: f.r2_key };
  });
  const sizes = await ctx.copyFiles(fileList.map((f) => ({ from: f.from, to: f.k })));
  const copiedFiles = fileList.filter((_, i) => sizes[i]);
  const fileIds = new Map(copiedFiles.map((f) => [f.o, f.n]));

  const docRows: Row[] = docList.map((d) => ({
    o: d.id,
    n: docIds.get(d.id)!,
    f: d.folder_id ? (folderIds.get(d.folder_id) ?? null) : null,
    c: d.category_id ? (categoryIds.get(d.category_id) ?? null) : null,
    file: d.file_id ? (fileIds.get(d.file_id) ?? null) : null
  }));

  // Docs with images point at the new files. Read their content one at a time, because a doc can be large.
  const contentUpdates: D1PreparedStatement[] = [];
  for (const d of docList) {
    if (d.kind === "pdf" || !d.has_images) continue;
    const row = await env.DB.prepare("SELECT content FROM docs_docs WHERE id = ?").bind(d.id).first<{ content: string }>();
    const next = row ? remapImages(row.content, fileIds) : null;
    if (next !== null) contentUpdates.push(env.DB.prepare("UPDATE docs_docs SET content = ? WHERE id = ?").bind(next, docIds.get(d.id)!));
  }

  const aiEnabled = (settings!.results[0] as { ai_enabled: number } | undefined)?.ai_enabled;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO docs_library (company_id, rev) VALUES (?, 1) ON CONFLICT (company_id) DO UPDATE SET rev = rev + 1").bind(toId),
    ...(aiEnabled === undefined
      ? []
      : [env.DB.prepare("INSERT INTO docs_settings (company_id, ai_enabled, updated_at) VALUES (?, ?, ?)").bind(toId, aiEnabled, now)]),
    ...ctx.copyStatements(
      `INSERT INTO docs_folders (id, company_id, parent_id, name, created_by, created_at, updated_at)
       SELECT ${j("n")}, ?2, ${j("p")}, f.name, ?3, ?4, ?4
       FROM json_each(?1) AS m JOIN docs_folders f ON f.id = ${j("o")}`,
      folderRows,
      toId,
      userId,
      now
    ),
    ...ctx.copyStatements(
      `INSERT INTO docs_categories (id, company_id, name, color, position, created_at)
       SELECT ${j("n")}, ?2, c.name, c.color, c.position, ?3
       FROM json_each(?1) AS m JOIN docs_categories c ON c.id = ${j("o")}`,
      [...categoryIds].map(([o, n]) => ({ o, n })),
      toId,
      now
    ),
    ...ctx.copyStatements(
      `INSERT INTO docs_tags (id, company_id, name, created_at)
       SELECT ${j("n")}, ?2, t.name, ?3
       FROM json_each(?1) AS m JOIN docs_tags t ON t.id = ${j("o")}`,
      [...tagIds].map(([o, n]) => ({ o, n })),
      toId,
      now
    ),
    ...ctx.copyStatements(
      `INSERT INTO docs_docs (id, company_id, folder_id, category_id, title, content, page_size, orientation, margin, rev,
                             header, footer, hide_first, kind, file_id, created_by, updated_by, created_at, updated_at)
       SELECT ${j("n")}, ?2, ${j("f")}, ${j("c")}, d.title, d.content, d.page_size, d.orientation, d.margin, 1,
              d.header, d.footer, d.hide_first, d.kind, ${j("file")}, ?3, ?3, ?4, ?4
       FROM json_each(?1) AS m JOIN docs_docs d ON d.id = ${j("o")}`,
      docRows,
      toId,
      userId,
      now
    ),
    ...ctx.copyStatements(
      `INSERT INTO docs_doc_tags (doc_id, tag_id) SELECT ${j("d")}, ${j("t")} FROM json_each(?1) AS m`,
      (docTags!.results as Array<{ doc_id: string; tag_id: string }>).flatMap((dt) => {
        const d = docIds.get(dt.doc_id);
        const t = tagIds.get(dt.tag_id);
        return d && t ? [{ d, t }] : [];
      })
    ),
    ...ctx.copyStatements(
      `INSERT INTO docs_files (id, company_id, doc_id, r2_key, content_type, size, name, uploaded_by, created_at)
       SELECT ${j("n")}, ?2, ${j("d")}, ${j("k")}, f.content_type, f.size, f.name, ?3, ?4
       FROM json_each(?1) AS m JOIN docs_files f ON f.id = ${j("o")}`,
      copiedFiles.map(({ o, n, d, k }) => ({ o, n, d, k })),
      toId,
      userId,
      now
    ),
    ...contentUpdates
  ];
  await env.DB.batch(stmts);

  const pdfs = docList.filter((d) => d.kind === "pdf").length;
  return [
    { label: "Docs", count: docList.length - pdfs },
    { label: "PDFs", count: pdfs },
    { label: "Doc folders", count: folderRows.length },
    { label: "Doc files", count: copiedFiles.length }
  ];
}
