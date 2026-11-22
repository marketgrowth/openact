import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MAX_NEW_TASKS, createProject } from "../apps/projects/src/server/api.ts";

/*
 * createProject from @openact/app-projects/api, run on SQLite with every migration and a small D1 stand-in.
 * Other apps (such as a primary app with a plan template) use it to start a project with tasks.
 */

const ROOT = join(import.meta.dirname, "..");

function migrations(): string[] {
  const dirs = ["packages/core/migrations", "apps/projects/migrations"];
  return dirs.flatMap((d) =>
    readdirSync(join(ROOT, d))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(ROOT, d, f), "utf8"))
  );
}

/** Enough of D1 for createProject: prepare, bind, first and batch. */
function d1(db: DatabaseSync) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null
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

function setup() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations()) raw.exec(sql);
  const T = "2026-11-22T00:00:00.000Z";
  const ins = (sql: string, ...a: unknown[]) => raw.prepare(sql).run(...(a as never[]));
  ins("INSERT INTO users (id, email, name, created_at) VALUES ('u_ann', 'ann@x.com', 'Ann', ?)", T);
  ins("INSERT INTO companies (id, name, ai_defaults, created_by, created_at, updated_at) VALUES ('c1', 'Home Co', '{}', 'u_ann', ?, ?)", T, T);
  ins("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES ('c1', 'u_ann', 'owner', ?)", T);
  const env = { DB: d1(raw) } as any;
  return { env, raw };
}

const count = (raw: DatabaseSync, sql: string, ...a: unknown[]) => (raw.prepare(sql).get(...(a as never[])) as { n: number }).n;

test("createProject with no tasks makes an empty project, as before", async () => {
  const { env, raw } = setup();
  const { id, path } = await createProject(env, { companyId: "c1", name: "Engagement", ownerId: "u_ann" });
  assert.equal(path, `/p/${id}`);
  assert.equal(count(raw, "SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?", id), 0);
  assert.ok(count(raw, "SELECT COUNT(*) AS n FROM board_columns WHERE project_id = ?", id) > 0);
});

test("createProject adds the tasks in order, each in the first column of its status", async () => {
  const { env, raw } = setup();
  const { id } = await createProject(env, {
    companyId: "c1",
    name: "Licensing roadmap",
    ownerId: "u_ann",
    tasks: [
      { title: "Call the regional center", phase: "1. Regional center", priority: "high" },
      { title: "Ask which home type they need", phase: "1. Regional center", notes: "Write down the bed count too." },
      { title: "Enroll in the orientation", phase: "3. Orientation", status: "backlog", startDate: "2026-12-01", endDate: "2026-12-02" },
      { title: "Already done", status: "done" }
    ]
  });
  const rows = raw
    .prepare(
      `SELECT t.title, t.phase, t.notes, t.status, t.priority, t.start_date, t.end_date, t.sort_order, t.created_by, c.category
       FROM tasks t JOIN board_columns c ON c.id = t.column_id WHERE t.project_id = ? ORDER BY t.status, t.sort_order`
    )
    .all(id) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.category, r.status, "each task is in a column of its own status");
  for (const r of rows) assert.equal(r.created_by, "u_ann", "the owner is the author");
  const todo = rows.filter((r) => r.status === "todo");
  assert.deepEqual(
    todo.map((r) => r.title),
    ["Call the regional center", "Ask which home type they need"],
    "order is kept inside a column"
  );
  assert.equal(todo[0].priority, "high");
  assert.equal(todo[1].priority, "med", "the default priority is med");
  assert.equal(todo[1].notes, "Write down the bed count too.");
  const backlog = rows.find((r) => r.status === "backlog")!;
  assert.equal(backlog.start_date, "2026-12-01");
  assert.equal(backlog.end_date, "2026-12-02");
  assert.equal(backlog.phase, "3. Orientation");
});

test("createProject writes nothing when a task is not valid", async () => {
  const { env, raw } = setup();
  const bad = [
    [{ title: "" }, /title is required/],
    [{ title: "x".repeat(141) }, /title is too long/],
    [{ title: "Ok", status: "later" }, /status must be one of/],
    [{ title: "Ok", priority: "urgent" }, /priority must be one of/],
    [{ title: "Ok", startDate: "12/01/2026" }, /start date must be a date/],
    [{ title: "Ok", startDate: "2026-12-02", endDate: "2026-12-01" }, /ends before it starts/]
  ] as const;
  for (const [task, message] of bad) {
    await assert.rejects(createProject(env, { companyId: "c1", name: "Bad", ownerId: "u_ann", tasks: [task as any] }), message);
  }
  const tooMany = Array.from({ length: MAX_NEW_TASKS + 1 }, (_, i) => ({ title: `Task ${i}` }));
  await assert.rejects(createProject(env, { companyId: "c1", name: "Big", ownerId: "u_ann", tasks: tooMany }), /200 tasks or fewer/);
  assert.equal(count(raw, "SELECT COUNT(*) AS n FROM projects"), 0, "no project is made");
});
