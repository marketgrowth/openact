import type { CompanyCopyContext, Env } from "@openact/core/server";

/*
 * Duplicate company, projects part: copies every project of a company with its columns, tasks and task files.
 *
 * The person who duplicates owns each copied project. Other project members, invitations, assignees,
 * access requests, pins, recent tasks and AI agent history are not copied, because they belong to people.
 * New tasks go into the search index through the vector_outbox triggers.
 *
 * Imports only types, so tests can run it on SQLite.
 */

type Row = Record<string, string | number | null>;

/** The value of a field of the current json_each row. */
const j = (field: string) => `json_extract(m.value, '$.${field}')`;

export async function duplicateProjects(env: Env, ctx: CompanyCopyContext) {
  const { fromId, toId, userId, now } = ctx;
  const [projects, columns, tasks, files] = await env.DB.batch([
    env.DB.prepare("SELECT id FROM projects WHERE company_id = ? ORDER BY created_at").bind(fromId),
    env.DB.prepare("SELECT c.id, c.project_id FROM board_columns c JOIN projects p ON p.id = c.project_id WHERE p.company_id = ?").bind(fromId),
    env.DB.prepare("SELECT t.id, t.project_id, t.column_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.company_id = ?").bind(fromId),
    env.DB.prepare(
      "SELECT a.id, a.task_id, a.r2_key FROM attachments a JOIN projects p ON p.id = a.project_id WHERE p.company_id = ? ORDER BY a.created_at"
    ).bind(fromId)
  ]);

  const projectIds = new Map<string, string>();
  for (const p of projects!.results as Array<{ id: string }>) projectIds.set(p.id, ctx.newId());
  const columnIds = new Map<string, string>();
  for (const c of columns!.results as Array<{ id: string }>) columnIds.set(c.id, ctx.newId());
  const taskIds = new Map<string, { id: string; project: string }>();
  const taskRows: Row[] = [];
  for (const t of tasks!.results as Array<{ id: string; project_id: string; column_id: string | null }>) {
    const id = ctx.newId();
    const project = projectIds.get(t.project_id)!;
    taskIds.set(t.id, { id, project });
    taskRows.push({ o: t.id, n: id, p: project, c: t.column_id ? (columnIds.get(t.column_id) ?? null) : null });
  }

  // Task files first. A file that is missing from storage is left out.
  const fileList = (files!.results as Array<{ id: string; task_id: string; r2_key: string }>).flatMap((f) => {
    const task = taskIds.get(f.task_id);
    if (!task) return [];
    const id = ctx.newId();
    return [{ o: f.id, n: id, p: task.project, t: task.id, k: `projects/${task.project}/tasks/${task.id}/${id}`, from: f.r2_key }];
  });
  const sizes = await ctx.copyFiles(fileList.map((f) => ({ from: f.from, to: f.k })));
  const fileRows: Row[] = fileList.filter((_, i) => sizes[i]).map(({ o, n, p, t, k }) => ({ o, n, p, t, k }));

  const projectRows: Row[] = [...projectIds].map(([o, n]) => ({ o, n }));
  const columnRows: Row[] = (columns!.results as Array<{ id: string; project_id: string }>).map((c) => ({
    o: c.id,
    n: columnIds.get(c.id)!,
    p: projectIds.get(c.project_id)!
  }));

  const stmts: D1PreparedStatement[] = [
    ...ctx.copyStatements(
      `INSERT INTO projects (id, name, description, color, rev, company_id, visibility, ai_policy, created_by, created_at, updated_at)
       SELECT ${j("n")}, p.name, p.description, p.color, 1, ?2, p.visibility, p.ai_policy, ?3, ?4, ?4
       FROM json_each(?1) AS m JOIN projects p ON p.id = ${j("o")}`,
      projectRows,
      toId,
      userId,
      now
    ),
    // The person who duplicates owns every copy, so secret projects stay open to them.
    ...ctx.copyStatements(
      `INSERT INTO project_members (project_id, user_id, role, created_at) SELECT ${j("n")}, ?2, 'owner', ?3 FROM json_each(?1) AS m`,
      projectRows,
      userId,
      now
    ),
    ...ctx.copyStatements(
      `INSERT INTO board_columns (id, project_id, name, category, position, created_at)
       SELECT ${j("n")}, ${j("p")}, c.name, c.category, c.position, ?2
       FROM json_each(?1) AS m JOIN board_columns c ON c.id = ${j("o")}`,
      columnRows,
      now
    ),
    // Assignees are people of the other company, so the copies have none.
    ...ctx.copyStatements(
      `INSERT INTO tasks (id, project_id, column_id, title, notes, status, priority, phase, start_date, end_date, assignee_id, sort_order, created_by, updated_by, created_at, updated_at)
       SELECT ${j("n")}, ${j("p")}, ${j("c")}, t.title, t.notes, t.status, t.priority, t.phase, t.start_date, t.end_date, NULL, t.sort_order, ?2, ?2, ?3, ?3
       FROM json_each(?1) AS m JOIN tasks t ON t.id = ${j("o")}`,
      taskRows,
      userId,
      now
    ),
    ...ctx.copyStatements(
      `INSERT INTO attachments (id, project_id, task_id, r2_key, filename, content_type, size, uploaded_by, created_at)
       SELECT ${j("n")}, ${j("p")}, ${j("t")}, ${j("k")}, a.filename, a.content_type, a.size, ?2, ?3
       FROM json_each(?1) AS m JOIN attachments a ON a.id = ${j("o")}`,
      fileRows,
      userId,
      now
    )
  ];
  if (stmts.length) await env.DB.batch(stmts);

  return [
    { label: "Projects", count: projectRows.length },
    { label: "Tasks", count: taskRows.length },
    { label: "Task files", count: fileRows.length }
  ];
}
