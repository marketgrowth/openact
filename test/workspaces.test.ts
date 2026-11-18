import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ALL_WORKSPACES, pickWorkspace, workspaceSlug, type Workspace } from "../packages/core/src/shared/types.ts";
import { createWorkspace, defaultWorkspaceId, listWorkspaces, resolveWorkspace, updateWorkspace } from "../packages/core/src/server/workspace-store.ts";
type HttpError = { status: number; message: string };

/*
 * Workspaces, run on SQLite with the real migrations and a small D1 stand-in.
 */

const ROOT = join(import.meta.dirname, "..");
const T = "2026-01-01T00:00:00.000Z";

/** The workspace migrations. They run last, the way they run on a deploy that has data. */
const NEW = new Set(["packages/core/migrations/0011_workspaces.sql", "apps/projects/migrations/0002_workspaces.sql", "apps/docs/migrations/0006_workspaces.sql"]);

function files(dirs: string[]): string[] {
  return dirs.flatMap((d) =>
    readdirSync(join(ROOT, d))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => `${d}/${f}`)
  );
}
const ALL = files(["packages/core/migrations", "apps/advisory/migrations", "apps/docs/migrations", "apps/projects/migrations"]);
const run = (db: DatabaseSync, list: string[]) => {
  for (const f of list) db.exec(readFileSync(join(ROOT, f), "utf8"));
};

/** Enough of D1 for the workspace code. */
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
    batch: async (list: Array<ReturnType<typeof stmt>>) => list.map((s) => ({ results: db.prepare(s.sql).all(...(s.args as never[])) }))
  };
}

function seed(db: DatabaseSync) {
  const ins = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));
  for (const [id, email] of [
    ["u_own", "own@x.com"],
    ["u_mem", "mem@x.com"],
    ["u_gst", "gst@x.com"]
  ])
    ins("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, '', ?)", id, email, T);
  ins("INSERT INTO companies (id, name, created_by, created_at, updated_at) VALUES ('c1', 'Acme Holdings', 'u_own', ?, ?)", T, T);
  ins("INSERT INTO companies (id, name, created_by, created_at, updated_at) VALUES ('c2', 'Partner Agency', 'u_own', ?, ?)", T, T);
  for (const [u, r] of [
    ["u_own", "owner"],
    ["u_mem", "member"],
    ["u_gst", "guest"]
  ])
    ins("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES ('c1', ?, ?, ?)", u, r, T);
  ins("UPDATE users SET current_company_id = 'c1' WHERE id IN ('u_own', 'u_mem')");
  ins("INSERT INTO projects (id, name, company_id, created_by, created_at, updated_at) VALUES ('p1', 'Launch', 'c1', 'u_own', ?, ?)", T, T);
  ins("INSERT INTO docs_folders (id, company_id, name, created_at, updated_at) VALUES ('f1', 'c1', 'Policies', ?, ?)", T, T);
  ins("INSERT INTO docs_docs (id, company_id, folder_id, title, content, created_at, updated_at) VALUES ('d1', 'c1', 'f1', 'Handbook', '{}', ?, ?)", T, T);
}

/** A deploy with data, upgraded to workspaces. */
function upgraded() {
  const db = new DatabaseSync(":memory:");
  run(
    db,
    ALL.filter((f) => !NEW.has(f))
  );
  seed(db);
  run(
    db,
    ALL.filter((f) => NEW.has(f))
  );
  return { db, env: { DB: d1(db) } as any };
}

const one = <T>(db: DatabaseSync, sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as never[])) as T;

test("the migration gives each existing company one default workspace, and moves existing work into it", () => {
  const { db } = upgraded();
  const rows = db.prepare("SELECT company_id, name, slug, kind, is_default FROM workspaces ORDER BY company_id").all() as any[];
  assert.deepEqual(
    rows.map((r) => [r.company_id, r.name, r.slug, r.kind, r.is_default]),
    [
      ["c1", "Acme Holdings", "main", "brand", 1],
      ["c2", "Partner Agency", "main", "brand", 1]
    ]
  );
  const def = one<{ id: string }>(db, "SELECT id FROM workspaces WHERE company_id = 'c1'").id;
  assert.equal(one<any>(db, "SELECT workspace_id FROM projects WHERE id = 'p1'").workspace_id, def);
  assert.equal(one<any>(db, "SELECT workspace_id FROM docs_folders WHERE id = 'f1'").workspace_id, def);
  assert.equal(one<any>(db, "SELECT workspace_id FROM docs_docs WHERE id = 'd1'").workspace_id, def);
  assert.equal(one<any>(db, "SELECT current_workspace_id FROM users WHERE id = 'u_own'").current_workspace_id, def);
  assert.equal(one<any>(db, "SELECT current_workspace_id FROM users WHERE id = 'u_gst'").current_workspace_id, null);
});

test("a new company gets its default workspace, and new rows without a workspace go to it", () => {
  const { db } = upgraded();
  db.prepare("INSERT INTO companies (id, name, created_at, updated_at) VALUES ('c3', 'New Co', ?, ?)").run(T, T);
  const def = one<{ id: string; is_default: number }>(db, "SELECT id, is_default FROM workspaces WHERE company_id = 'c3'");
  assert.equal(def.is_default, 1);
  db.prepare("INSERT INTO projects (id, name, company_id, created_at, updated_at) VALUES ('p3', 'P', 'c3', ?, ?)").run(T, T);
  assert.equal(one<any>(db, "SELECT workspace_id FROM projects WHERE id = 'p3'").workspace_id, def.id);
  // A second default workspace is refused.
  assert.throws(() =>
    db
      .prepare("INSERT INTO workspaces (id, company_id, name, slug, is_default, created_at, updated_at) VALUES ('w9', 'c3', 'Again', 'again', 1, ?, ?)")
      .run(T, T)
  );
});

test("a doc or subfolder without a workspace goes to its folder's workspace", async () => {
  const { db, env } = upgraded();
  const brand = await createWorkspace(env, "c1", "u_own", { name: "Brand X" });
  db.prepare("INSERT INTO docs_folders (id, company_id, workspace_id, name, created_at, updated_at) VALUES ('fx', 'c1', ?, 'X files', ?, ?)").run(brand.id, T, T);
  db.prepare("INSERT INTO docs_folders (id, company_id, parent_id, name, created_at, updated_at) VALUES ('fx2', 'c1', 'fx', 'Sub', ?, ?)").run(T, T);
  db.prepare("INSERT INTO docs_docs (id, company_id, folder_id, title, content, created_at, updated_at) VALUES ('dx', 'c1', 'fx2', 'Signed', '{}', ?, ?)").run(T, T);
  assert.equal(one<any>(db, "SELECT workspace_id FROM docs_folders WHERE id = 'fx2'").workspace_id, brand.id);
  assert.equal(one<any>(db, "SELECT workspace_id FROM docs_docs WHERE id = 'dx'").workspace_id, brand.id);
});

test("owners and admins add workspaces with unique slugs, and the default one cannot be archived", async () => {
  const { env } = upgraded();
  const a = await createWorkspace(env, "c1", "u_own", { name: "Acme Health", kind: "business_unit", website: "acmehealth.com", colors: { primary: "#1F2937" } });
  assert.equal(a.slug, "acme-health");
  assert.equal(a.kind, "business_unit");
  assert.equal(a.website, "https://acmehealth.com");
  assert.deepEqual(a.colors, { primary: "#1f2937" });
  const b = await createWorkspace(env, "c1", "u_own", { name: "Acme Health!" });
  assert.equal(b.slug, "acme-health-2");
  await assert.rejects(updateWorkspace(env, "c1", b.id, { slug: "acme-health" }), (e: HttpError) => e.status === 409);
  await assert.rejects(createWorkspace(env, "c1", "u_own", { name: "Bad", kind: "team" }), (e: HttpError) => e.status === 400);
  await assert.rejects(createWorkspace(env, "c1", "u_own", { name: "Bad", colors: { primary: "red" } }), (e: HttpError) => e.status === 400);

  const def = await defaultWorkspaceId(env, "c1");
  await assert.rejects(updateWorkspace(env, "c1", def, { archived: true }), (e: HttpError) => e.status === 400 && /default workspace/.test(e.message));
  const archived = await updateWorkspace(env, "c1", b.id, { archived: true });
  assert.equal(archived.archived, true);
  const active = (await listWorkspaces(env, ["c1"])).get("c1")!;
  assert.deepEqual(
    active.map((w) => [w.name, w.isDefault]),
    [
      ["Acme Holdings", true],
      ["Acme Health", false]
    ]
  );
  assert.equal((await listWorkspaces(env, ["c1"], { archived: true })).get("c1")!.length, 3);
  // A workspace of another company is not found.
  await assert.rejects(updateWorkspace(env, "c2", a.id, { name: "Moved" }), (e: HttpError) => e.status === 404);
});

test("which workspace a request works in", async () => {
  const { db, env } = upgraded();
  const def = await defaultWorkspaceId(env, "c1");
  const brand = await createWorkspace(env, "c1", "u_own", { name: "Brand Y" });
  const old = await createWorkspace(env, "c1", "u_own", { name: "Old brand" });
  await updateWorkspace(env, "c1", old.id, { archived: true });
  const r = (userId: string, role: any, wanted?: string) => resolveWorkspace(env, { companyId: "c1", userId, role, wanted });

  // Guests see every workspace they are invited to.
  assert.equal(await r("u_gst", "guest", brand.id), null);
  // "all" is for owners and admins only.
  assert.equal(await r("u_own", "owner", ALL_WORKSPACES), null);
  assert.equal(await r("u_mem", "member", ALL_WORKSPACES), def);
  // An id picks that workspace.
  assert.equal(await r("u_mem", "member", brand.id), brand.id);
  // An archived workspace opens for owners and admins, by id only.
  assert.equal(await r("u_own", "admin", old.id), old.id);
  await assert.rejects(r("u_mem", "member", old.id), (e: HttpError) => e.status === 404);
  // A workspace of another company is not found.
  const other = await createWorkspace(env, "c2", "u_own", { name: "Client A" });
  await assert.rejects(r("u_own", "owner", other.id), (e: HttpError) => e.status === 404);
  // Without an id, the saved choice counts, unless it is archived, gone or in another company.
  db.prepare("UPDATE users SET current_workspace_id = ? WHERE id = 'u_mem'").run(brand.id);
  assert.equal(await r("u_mem", "member"), brand.id);
  db.prepare("UPDATE users SET current_workspace_id = ? WHERE id = 'u_mem'").run(old.id);
  assert.equal(await r("u_mem", "member"), def);
  db.prepare("UPDATE users SET current_workspace_id = ? WHERE id = 'u_mem'").run(other.id);
  assert.equal(await r("u_mem", "member"), def);
  db.prepare("UPDATE users SET current_workspace_id = 'all' WHERE id IN ('u_mem', 'u_own')").run();
  assert.equal(await r("u_mem", "member"), def);
  assert.equal(await r("u_own", "owner"), null);
});

test("the web app picks the same workspace as the server", () => {
  const ws = (id: string, isDefault = false) => ({ id, isDefault }) as Workspace;
  const company = { role: "member" as const, workspaces: [ws("w1", true), ws("w2")] };
  assert.equal(pickWorkspace(company, "w2"), "w2");
  assert.equal(pickWorkspace(company, "gone"), "w1");
  assert.equal(pickWorkspace(company, null), "w1");
  assert.equal(pickWorkspace(company, ALL_WORKSPACES), "w1");
  assert.equal(pickWorkspace({ ...company, role: "admin" }, ALL_WORKSPACES), ALL_WORKSPACES);
  assert.equal(pickWorkspace({ role: "guest", workspaces: [] }, "w2"), null);
});

test("slugs from names", () => {
  assert.equal(workspaceSlug("Acme Health (West)"), "acme-health-west");
  assert.equal(workspaceSlug("Café Lumière"), "cafe-lumiere");
  assert.equal(workspaceSlug("!!!"), "workspace");
});
