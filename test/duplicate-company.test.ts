import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DUPLICATE_MAX_FILES } from "../packages/core/src/shared/site.ts";
import { CopyError, deleteCompanyData, duplicateCompany } from "../packages/core/src/server/company-copy.ts";
import { duplicateProjects } from "../apps/projects/src/server/duplicate.ts";
import { duplicateDocs, remapImages } from "../apps/docs/src/server/duplicate.ts";
import { fileSrc } from "../apps/docs/src/shared/types.ts";

/*
 * Duplicate company, run on SQLite with every migration, a small D1 stand-in and an R2 stand-in in memory.
 */

const ROOT = join(import.meta.dirname, "..");

function migrations(): string[] {
  const dirs = ["packages/core/migrations", "apps/advisory/migrations", "apps/docs/migrations", "apps/projects/migrations"];
  return dirs.flatMap((d) =>
    readdirSync(join(ROOT, d))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(ROOT, d, f), "utf8"))
  );
}

/** Enough of D1 for the copy code: prepare, bind, first, all, run and batch. */
function d1(db: DatabaseSync) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => ({ meta: db.prepare(sql).run(...(args as never[])) })
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: Array<ReturnType<typeof stmt>>) => {
      db.exec("BEGIN");
      try {
        const out = list.map((s) => {
          const p = db.prepare(s.sql);
          return { results: p.columns().length ? p.all(...(s.args as never[])) : (p.run(...(s.args as never[])), []) };
        });
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  };
}

/** Enough of R2 for the copy code. */
function r2() {
  const objects = new Map<string, { data: Uint8Array; type?: string }>();
  return {
    objects,
    get: async (key: string) => {
      const o = objects.get(key);
      if (!o) return null;
      return { size: o.data.byteLength, httpMetadata: { contentType: o.type }, customMetadata: {}, body: null, arrayBuffer: async () => o.data.slice().buffer };
    },
    put: async (key: string, data: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
      objects.set(key, { data: new Uint8Array(data), type: opts?.httpMetadata?.contentType });
    },
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    list: async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false })
  };
}

const APPS = [
  { id: "projects", hooks: { companyDuplicating: duplicateProjects, companyDeleting: deleteProjects } },
  { id: "docs", hooks: { companyDuplicating: duplicateDocs, companyDeleting: deleteDocs } }
];

// The same clean-up as the apps' companyDeleting hooks.
async function deleteProjects(env: any, companyId: string) {
  const files = r2Of(env);
  const projects = env.DB.raw.prepare("SELECT id FROM projects WHERE company_id = ?").all(companyId) as Array<{ id: string }>;
  for (const p of projects) for (const k of [...files.objects.keys()]) if (k.startsWith(`projects/${p.id}/`)) files.objects.delete(k);
  env.DB.raw.prepare("DELETE FROM projects WHERE company_id = ?").run(companyId);
}
async function deleteDocs(env: any, companyId: string) {
  const files = r2Of(env);
  for (const k of [...files.objects.keys()]) if (k.startsWith(`docs/${companyId}/`)) files.objects.delete(k);
  for (const t of ["docs_files", "docs_docs", "docs_folders", "docs_categories", "docs_tags", "docs_library", "docs_settings"])
    env.DB.raw.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(companyId);
}
const r2Of = (env: any) => env.FILES as ReturnType<typeof r2>;

const T = "2026-01-01T00:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A site with two people and one company full of content. */
function setup() {
  const raw = new DatabaseSync(":memory:");
  for (const sql of migrations()) raw.exec(sql);
  const files = r2();
  const DB = Object.assign(d1(raw), { raw });
  const env = { DB, FILES: files } as any;
  const ins = (sql: string, ...a: unknown[]) => raw.prepare(sql).run(...(a as never[]));

  ins("INSERT INTO users (id, email, name, created_at) VALUES ('u_admin', 'admin@x.com', 'Admin', ?)", T);
  ins("INSERT INTO users (id, email, name, created_at) VALUES ('u_ann', 'ann@x.com', 'Ann', ?)", T);
  ins(
    "INSERT INTO companies (id, name, logo_key, logo_type, logo_updated_at, email_domain, ai_defaults, created_by, created_at, updated_at) VALUES ('c1', 'ICF/DD Co', 'companies/c1/logo', 'image/png', ?, 'icf.com', '{\"member\":\"suggest\"}', 'u_ann', ?, ?)",
    T,
    T,
    T
  );
  files.objects.set("companies/c1/logo", { data: new Uint8Array([1, 2]), type: "image/png" });
  ins("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES ('c1', 'u_ann', 'owner', ?)", T);
  ins("INSERT INTO company_apps (company_id, app_id, enabled, permissions, updated_at) VALUES ('c1', 'docs', 1, '{\"docs.edit\":[\"owner\"]}', ?)", T);
  ins("INSERT INTO company_app_blocks (company_id, app_id, created_at) VALUES ('c1', 'advisory', ?)", T);
  ins("INSERT INTO company_plans (company_id, plan, status, updated_at) VALUES ('c1', 'director', 'active', ?)", T);

  // Projects: one secret project with two columns, two tasks and one file.
  ins("INSERT INTO projects (id, name, description, color, company_id, visibility, ai_policy, created_by, created_at, updated_at) VALUES ('p1', 'Start-up', 'Plan', 'teal', 'c1', 'secret', '{}', 'u_ann', ?, ?)", T, T);
  ins("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ('p1', 'u_ann', 'owner', ?)", T);
  ins("INSERT INTO board_columns (id, project_id, name, category, position, created_at) VALUES ('col1', 'p1', 'To do', 'todo', 1, ?)", T);
  ins("INSERT INTO board_columns (id, project_id, name, category, position, created_at) VALUES ('col2', 'p1', 'Done', 'done', 2, ?)", T);
  ins(
    "INSERT INTO tasks (id, project_id, column_id, title, notes, status, phase, start_date, assignee_id, sort_order, created_by, created_at, updated_at) VALUES ('t1', 'p1', 'col1', 'Write the plan', 'notes', 'todo', 'Licensing', '2026-02-01', 'u_ann', 1, 'u_ann', ?, ?)",
    T,
    T
  );
  ins("INSERT INTO tasks (id, project_id, column_id, title, status, sort_order, created_by, created_at, updated_at) VALUES ('t2', 'p1', 'col2', 'Get the forms', 'done', 2, 'u_ann', ?, ?)", T, T);
  ins("INSERT INTO attachments (id, project_id, task_id, r2_key, filename, content_type, size, uploaded_by, created_at) VALUES ('a1', 'p1', 't1', 'projects/p1/tasks/t1/a1', 'form.pdf', 'application/pdf', 3, 'u_ann', ?)", T);
  files.objects.set("projects/p1/tasks/t1/a1", { data: new Uint8Array([7, 7, 7]), type: "application/pdf" });
  ins("INSERT INTO agent_actions (id, project_id, tool, args, summary, status, created_at) VALUES ('ag1', 'p1', 'x', '{}', 's', 'done', ?)", T);

  // Docs: a folder in a folder, a category, a tag, a doc with an image, a PDF with an old and a current file, a comment and a share link.
  ins("INSERT INTO docs_folders (id, company_id, parent_id, name, created_at, updated_at) VALUES ('f2', 'c1', NULL, 'Policies', ?, ?)", T, T);
  ins("INSERT INTO docs_folders (id, company_id, parent_id, name, created_at, updated_at) VALUES ('f1', 'c1', 'f2', 'Staffing', ?, ?)", T, T);
  ins("INSERT INTO docs_categories (id, company_id, name, color, position, created_at) VALUES ('cat1', 'c1', 'Policy', 'teal', 1, ?)", T);
  ins("INSERT INTO docs_tags (id, company_id, name, created_at) VALUES ('tag1', 'c1', 'DDS', ?)", T);
  const img = uuid(1);
  const content = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }, { type: "image", attrs: { src: fileSrc(img) } }] });
  ins(
    "INSERT INTO docs_docs (id, company_id, folder_id, category_id, title, content, header, footer, hide_first, created_by, created_at, updated_at) VALUES ('d1', 'c1', 'f1', 'cat1', 'Staffing plan', ?, 'Head', 'Page {page}', 1, 'u_ann', ?, ?)",
    content,
    T,
    T
  );
  ins("INSERT INTO docs_doc_tags (doc_id, tag_id) VALUES ('d1', 'tag1')");
  ins("INSERT INTO docs_files (id, company_id, doc_id, r2_key, content_type, size, created_at) VALUES (?, 'c1', 'd1', 'docs/c1/d1/img', 'image/png', 2, ?)", img, T);
  files.objects.set("docs/c1/d1/img", { data: new Uint8Array([9, 9]), type: "image/png" });
  ins("INSERT INTO docs_docs (id, company_id, title, content, kind, file_id, created_at, updated_at) VALUES ('d2', 'c1', 'Form', '{}', 'pdf', 'pdfnew', ?, ?)", T, T);
  ins("INSERT INTO docs_files (id, company_id, doc_id, r2_key, content_type, size, name, created_at) VALUES ('pdfold', 'c1', 'd2', 'docs/c1/d2/old', 'application/pdf', 1, 'old.pdf', ?)", T);
  ins("INSERT INTO docs_files (id, company_id, doc_id, r2_key, content_type, size, name, created_at) VALUES ('pdfnew', 'c1', 'd2', 'docs/c1/d2/new', 'application/pdf', 4, 'form.pdf', ?)", T);
  files.objects.set("docs/c1/d2/old", { data: new Uint8Array([1]), type: "application/pdf" });
  files.objects.set("docs/c1/d2/new", { data: new Uint8Array([4, 4, 4, 4]), type: "application/pdf" });
  ins("INSERT INTO docs_threads (id, company_id, doc_id, created_at, updated_at) VALUES ('th1', 'c1', 'd1', ?, ?)", T, T);
  ins("INSERT INTO docs_shares (doc_id, token_hash, token_box, created_at) VALUES ('d1', 'h', 'b', ?)", T);
  ins("INSERT INTO docs_settings (company_id, ai_enabled, updated_at) VALUES ('c1', 1, ?)", T);
  ins("INSERT INTO docs_library (company_id, rev) VALUES ('c1', 9)");
  return { env, raw, files };
}

const one = (raw: DatabaseSync, sql: string, ...a: unknown[]) => raw.prepare(sql).get(...(a as never[])) as any;
const many = (raw: DatabaseSync, sql: string, ...a: unknown[]) => raw.prepare(sql).all(...(a as never[])) as any[];

test("a duplicate copies the company, its projects and its docs, and leaves out people and history", async () => {
  const { env, raw, files } = setup();
  const before = files.objects.size;
  const r = await duplicateCompany(env, { fromId: "c1", name: "ICF/DD Co (copy)", userId: "u_admin", now: T }, APPS);
  const to = r.id;

  assert.deepEqual(
    r.copied.map((c) => `${c.label}: ${c.count}`),
    ["Projects: 1", "Tasks: 2", "Task files: 1", "Docs: 1", "PDFs: 1", "Doc folders: 2", "Doc files: 2"]
  );

  // The company: new name, the logo, AI defaults, app settings and blocks. No email domain, plan or other people.
  const co = one(raw, "SELECT * FROM companies WHERE id = ?", to);
  assert.equal(co.name, "ICF/DD Co (copy)");
  assert.equal(co.email_domain, null);
  assert.equal(co.ai_defaults, '{"member":"suggest"}');
  assert.equal(co.logo_key, `companies/${to}/logo`);
  assert.deepEqual([...files.objects.get(`companies/${to}/logo`)!.data], [1, 2]);
  assert.deepEqual(many(raw, "SELECT user_id, role FROM company_members WHERE company_id = ?", to).map((m) => ({ ...m })), [{ user_id: "u_admin", role: "owner" }]);
  assert.equal(one(raw, "SELECT permissions FROM company_apps WHERE company_id = ? AND app_id = 'docs'", to).permissions, '{"docs.edit":["owner"]}');
  assert.ok(one(raw, "SELECT 1 AS ok FROM company_app_blocks WHERE company_id = ? AND app_id = 'advisory'", to));
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM company_plans WHERE company_id = ?", to).n, 0);

  // Projects: the admin owns the copy, the tasks keep their columns, the assignee is gone and the file is copied.
  const p = one(raw, "SELECT * FROM projects WHERE company_id = ?", to);
  assert.notEqual(p.id, "p1");
  assert.equal(p.name, "Start-up");
  assert.equal(p.visibility, "secret");
  assert.deepEqual(many(raw, "SELECT user_id, role FROM project_members WHERE project_id = ?", p.id).map((m) => ({ ...m })), [{ user_id: "u_admin", role: "owner" }]);
  const t1 = one(raw, "SELECT t.*, c.name AS col FROM tasks t JOIN board_columns c ON c.id = t.column_id WHERE t.project_id = ? AND t.title = 'Write the plan'", p.id);
  assert.equal(t1.col, "To do");
  assert.equal(t1.notes, "notes");
  assert.equal(t1.phase, "Licensing");
  assert.equal(t1.start_date, "2026-02-01");
  assert.equal(t1.assignee_id, null);
  const att = one(raw, "SELECT * FROM attachments WHERE task_id = ?", t1.id);
  assert.equal(att.r2_key, `projects/${p.id}/tasks/${t1.id}/${att.id}`);
  assert.deepEqual([...files.objects.get(att.r2_key)!.data], [7, 7, 7]);
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM agent_actions WHERE project_id = ?", p.id).n, 0);
  // New tasks wait for the search index.
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM vector_outbox WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)", p.id).n, 2);

  // Docs: folders keep their tree, the doc keeps its category, tag, header and footer, and its image points at a new file.
  const staffing = one(raw, "SELECT * FROM docs_folders WHERE company_id = ? AND name = 'Staffing'", to);
  assert.equal(one(raw, "SELECT name FROM docs_folders WHERE id = ?", staffing.parent_id).name, "Policies");
  const d1 = one(raw, "SELECT * FROM docs_docs WHERE company_id = ? AND kind = 'doc'", to);
  assert.equal(d1.folder_id, staffing.id);
  assert.equal(one(raw, "SELECT name FROM docs_categories WHERE id = ?", d1.category_id).name, "Policy");
  assert.equal(one(raw, "SELECT t.name FROM docs_doc_tags dt JOIN docs_tags t ON t.id = dt.tag_id WHERE dt.doc_id = ?", d1.id).name, "DDS");
  assert.equal(d1.header, "Head");
  assert.equal(d1.footer, "Page {page}");
  assert.equal(d1.hide_first, 1);
  assert.equal(d1.created_by, "u_admin");
  const image = one(raw, "SELECT * FROM docs_files WHERE doc_id = ?", d1.id);
  assert.equal(image.company_id, to);
  assert.equal(image.r2_key, `docs/${to}/${d1.id}/${image.id}`);
  assert.deepEqual(JSON.parse(d1.content).content[1].attrs.src, fileSrc(image.id));
  assert.deepEqual([...files.objects.get(image.r2_key)!.data], [9, 9]);

  // The PDF copies only its current file, and points at the copy.
  const pdf = one(raw, "SELECT * FROM docs_docs WHERE company_id = ? AND kind = 'pdf'", to);
  const pdfFiles = many(raw, "SELECT * FROM docs_files WHERE doc_id = ?", pdf.id);
  assert.equal(pdfFiles.length, 1);
  assert.equal(pdf.file_id, pdfFiles[0].id);
  assert.equal(pdfFiles[0].name, "form.pdf");
  assert.deepEqual([...files.objects.get(pdfFiles[0].r2_key)!.data], [4, 4, 4, 4]);

  // No comments or share links. The AI setting and a library row are there.
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM docs_threads WHERE company_id = ?", to).n, 0);
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM docs_shares WHERE doc_id IN (SELECT id FROM docs_docs WHERE company_id = ?)", to).n, 0);
  assert.equal(one(raw, "SELECT ai_enabled FROM docs_settings WHERE company_id = ?", to).ai_enabled, 1);
  assert.equal(one(raw, "SELECT rev FROM docs_library WHERE company_id = ?", to).rev, 1);

  // The source company did not change. Files: logo, task file, image and the current PDF file are new.
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM tasks WHERE project_id = 'p1'").n, 2);
  assert.equal(one(raw, "SELECT content FROM docs_docs WHERE id = 'd1'").content.includes(uuid(1)), true);
  assert.equal(files.objects.size, before + 4);

  // Deleting the copy leaves the source and its files alone.
  await deleteCompanyData(env, to, APPS);
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM companies WHERE id = ?", to).n, 0);
  assert.equal(files.objects.size, before);
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM docs_docs WHERE company_id = 'c1'").n, 2);
});

test("a failed duplicate leaves nothing behind", async () => {
  const { env, raw, files } = setup();
  const before = files.objects.size;
  const broken = { id: "broken", hooks: { companyDuplicating: async () => Promise.reject(new Error("boom")) } };
  await assert.rejects(duplicateCompany(env, { fromId: "c1", name: "Copy", userId: "u_admin" }, [...APPS, broken]), /boom/);
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM companies").n, 1);
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM projects").n, 1);
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM docs_docs").n, 2);
  assert.equal(files.objects.size, before);
});

test("a duplicate refuses a missing company and too many files", async () => {
  const { env, raw, files } = setup();
  await assert.rejects(duplicateCompany(env, { fromId: "nope", name: "Copy", userId: "u_admin" }, APPS), (e: unknown) => e instanceof CopyError && e.status === 404);
  for (let i = 0; i < DUPLICATE_MAX_FILES; i++) {
    raw.prepare("INSERT INTO attachments (id, project_id, task_id, r2_key, filename, content_type, size, created_at) VALUES (?, 'p1', 't2', ?, 'f', 'text/plain', 1, ?)").run(`x${i}`, `projects/p1/tasks/t2/x${i}`, T);
    files.objects.set(`projects/p1/tasks/t2/x${i}`, { data: new Uint8Array([1]) });
  }
  const before = files.objects.size;
  await assert.rejects(
    duplicateCompany(env, { fromId: "c1", name: "Copy", userId: "u_admin" }, APPS),
    (e: unknown) => e instanceof CopyError && e.status === 400 && /more than 400 files/.test(e.message)
  );
  assert.equal(one(raw, "SELECT COUNT(*) AS n FROM companies").n, 1);
  assert.equal(files.objects.size, before);
});

test("images point at their copies, and other content stays the same", () => {
  const a = uuid(1);
  const b = uuid(2);
  const doc = { type: "doc", content: [{ type: "table", content: [{ type: "image", attrs: { src: fileSrc(a), alt: "x" } }] }, { type: "image", attrs: { src: "https://evil.example/x.png" } }] };
  const out = JSON.parse(remapImages(JSON.stringify(doc), new Map([[a, b]]))!);
  assert.equal(out.content[0].content[0].attrs.src, fileSrc(b));
  assert.equal(out.content[0].content[0].attrs.alt, "x");
  assert.equal(out.content[1].attrs.src, "https://evil.example/x.png");
  assert.equal(remapImages(JSON.stringify(doc), new Map()), null);
  assert.equal(remapImages("not json", new Map([[a, b]])), null);
});
