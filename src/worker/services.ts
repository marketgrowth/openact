import type { Env } from "./env";
import { DEFAULT_COLUMNS, PRIORITY_IDS, ROLES, ROLE_LABELS, STATUS_IDS, type Role, type Status, type User } from "../shared/types";
import { bumpRev, isMember, loadColumns, requireRole, revFrom, toColumn, toTask, type ColumnRow, type TaskRow } from "./data";
import { inviteEmail, sendEmail } from "./email";
import { HttpError, dateOrNull, isEmail, newId, normalizeEmail, nowIso, num, oneOf, text } from "./util";

/*
 * Business rules for tasks, columns and members.
 * The API routes and the AI agent both call these functions, so a person and their agent
 * always go through the same role checks, validation and sync (bumpRev).
 */

type Body = Record<string, unknown>;

/* Columns */

/** Statements that give a new project the five default columns. Returns the statements and the new column ids by category. */
export function defaultColumnStatements(env: Env, projectId: string): { stmts: D1PreparedStatement[]; ids: Record<Status, string> } {
  const iso = nowIso();
  const ids = {} as Record<Status, string>;
  const stmts = DEFAULT_COLUMNS.map((c, i) => {
    const id = newId();
    ids[c.category] = id;
    return env.DB.prepare("INSERT INTO board_columns (id, project_id, name, category, position, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id,
      projectId,
      c.name,
      c.category,
      (i + 1) * 1000,
      iso
    );
  });
  return { stmts, ids };
}

async function loadColumn(env: Env, columnId: string): Promise<ColumnRow> {
  const row = await env.DB.prepare("SELECT id, project_id, name, category, position FROM board_columns WHERE id = ?").bind(columnId).first<ColumnRow>();
  if (!row) throw new HttpError(404, "This column does not exist. Someone may have deleted it.");
  return row;
}

/** Finds the column a task goes to: the given column, else the first column of the given status, else the first To do column, else the first column. */
async function resolveColumn(env: Env, projectId: string, columnId: unknown, status: unknown): Promise<ColumnRow> {
  const cols = await loadColumns(env, projectId);
  if (!cols.length) throw new HttpError(400, "This project has no columns. Add a column first.");
  if (columnId !== undefined && columnId !== null && columnId !== "") {
    const col = cols.find((c) => c.id === columnId);
    if (!col) throw new HttpError(400, "The column must belong to this project.");
    return col;
  }
  const wanted = status !== undefined ? oneOf(status, "Status", STATUS_IDS) : "todo";
  return cols.find((c) => c.category === wanted) ?? cols.find((c) => c.category === "todo") ?? cols[0];
}

/** A position between two neighbors, or after the last one. */
function positionAfter(cols: ColumnRow[], afterId: string | null | undefined): number {
  if (afterId === undefined) return (cols[cols.length - 1]?.position ?? 0) + 1000;
  if (afterId === null) return (cols[0]?.position ?? 1000) - 1000;
  const i = cols.findIndex((c) => c.id === afterId);
  if (i === -1) throw new HttpError(400, "The column to place it after does not belong to this project.");
  const next = cols[i + 1];
  return next ? (cols[i].position + next.position) / 2 : cols[i].position + 1000;
}

export async function createColumn(env: Env, actor: User, projectId: string, body: Body) {
  await requireRole(env, projectId, actor.id, "editor");
  const name = text(body.name, "Column name", { max: 40, required: true });
  const category = body.category === undefined ? "todo" : oneOf(body.category, "Category", STATUS_IDS);
  const cols = await loadColumns(env, projectId);
  if (cols.length >= 12) throw new HttpError(400, "A board can have 12 columns or fewer.");
  const afterId = body.afterColumnId === undefined || body.afterColumnId === "" ? undefined : (body.afterColumnId as string | null);
  const id = newId();
  const res = await env.DB.batch([
    env.DB.prepare("INSERT INTO board_columns (id, project_id, name, category, position, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id,
      projectId,
      name,
      category,
      positionAfter(cols, afterId),
      nowIso()
    ),
    bumpRev(env, projectId)
  ]);
  return { column: toColumn({ id, project_id: projectId, name, category, position: positionAfter(cols, afterId) }), rev: revFrom(res) };
}

export async function updateColumn(env: Env, actor: User, columnId: string, body: Body) {
  const col = await loadColumn(env, columnId);
  await requireRole(env, col.project_id, actor.id, "editor");
  const sets: string[] = [];
  const vals: unknown[] = [];
  const stmts: D1PreparedStatement[] = [];
  let next = { ...col };
  if (body.name !== undefined) {
    next.name = text(body.name, "Column name", { max: 40, required: true });
    sets.push("name = ?");
    vals.push(next.name);
  }
  if (body.category !== undefined) {
    next.category = oneOf(body.category, "Category", STATUS_IDS);
    sets.push("category = ?");
    vals.push(next.category);
    // Tasks keep their status in step with their column's category.
    stmts.push(env.DB.prepare("UPDATE tasks SET status = ? WHERE column_id = ?").bind(next.category, col.id));
  }
  if (body.afterColumnId !== undefined) {
    const others = (await loadColumns(env, col.project_id)).filter((c) => c.id !== col.id);
    next.position = positionAfter(others, body.afterColumnId as string | null);
    sets.push("position = ?");
    vals.push(next.position);
  } else if (body.position !== undefined) {
    next.position = num(body.position, "Position");
    sets.push("position = ?");
    vals.push(next.position);
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change.");
  const res = await env.DB.batch([env.DB.prepare(`UPDATE board_columns SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, col.id), ...stmts, bumpRev(env, col.project_id)]);
  return { column: toColumn(next), rev: revFrom(res) };
}

/** Deletes a column. Its tasks move to another column first, so no task is lost. Owners only. */
export async function deleteColumn(env: Env, actor: User, columnId: string, moveToColumnId: unknown) {
  const col = await loadColumn(env, columnId);
  await requireRole(env, col.project_id, actor.id, "owner");
  const cols = await loadColumns(env, col.project_id);
  if (cols.length <= 1) throw new HttpError(400, "A board needs at least one column.");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE column_id = ?").bind(col.id).first<{ n: number }>();
  const target = typeof moveToColumnId === "string" ? cols.find((c) => c.id === moveToColumnId && c.id !== col.id) : undefined;
  if ((count?.n ?? 0) > 0 && !target) throw new HttpError(400, "Choose a column for the tasks in this column.");
  const stmts: D1PreparedStatement[] = [];
  if (target) stmts.push(env.DB.prepare("UPDATE tasks SET column_id = ?, status = ? WHERE column_id = ?").bind(target.id, target.category, col.id));
  stmts.push(env.DB.prepare("DELETE FROM board_columns WHERE id = ?").bind(col.id), bumpRev(env, col.project_id));
  const res = await env.DB.batch(stmts);
  return { moved: count?.n ?? 0, name: col.name, rev: revFrom(res) };
}

/* Tasks */

async function parseTaskFields(env: Env, projectId: string, body: Body, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) out.title = text(body.title, "Title", { max: 140, required: true });
  if (body.notes !== undefined) out.notes = text(body.notes, "Notes", { max: 8000 });
  if (body.priority !== undefined) out.priority = oneOf(body.priority, "Priority", PRIORITY_IDS);
  if (body.phase !== undefined) out.phase = text(body.phase, "Phase", { max: 60 });
  if (body.order !== undefined) out.sort_order = num(body.order, "Order");
  if (body.start !== undefined || body.end !== undefined) {
    let start = dateOrNull(body.start, "Start date");
    let end = dateOrNull(body.end, "End date");
    if (start && !end) end = start;
    if (end && !start) start = end;
    if (start && end && end < start) throw new HttpError(400, "The end date must be on or after the start date.");
    out.start_date = start;
    out.end_date = end;
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId === null || body.assigneeId === "") out.assignee_id = null;
    else if (typeof body.assigneeId === "string" && (await isMember(env, projectId, body.assigneeId))) out.assignee_id = body.assigneeId;
    else throw new HttpError(400, "The assignee must be a member of this project.");
  }
  return out;
}

async function nextOrderInColumn(env: Env, columnId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT MAX(sort_order) AS m FROM tasks WHERE column_id = ?").bind(columnId).first<{ m: number | null }>();
  return (row?.m ?? 0) + 1000;
}

async function loadTask(env: Env, taskId: string): Promise<TaskRow> {
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<TaskRow>();
  if (!row) throw new HttpError(404, "This task does not exist. Someone may have deleted it.");
  return row;
}

function insertTask(env: Env, actor: User, projectId: string, f: Record<string, unknown>, col: ColumnRow, order: number, iso: string, id = newId()) {
  return env.DB.prepare(
    `INSERT INTO tasks (id, project_id, column_id, title, notes, status, priority, phase, start_date, end_date, assignee_id, sort_order, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    projectId,
    col.id,
    f.title,
    f.notes ?? "",
    col.category,
    f.priority ?? "med",
    f.phase ?? "",
    f.start_date ?? null,
    f.end_date ?? null,
    f.assignee_id ?? null,
    order,
    actor.id,
    actor.id,
    iso,
    iso
  );
}

export async function createTask(env: Env, actor: User, projectId: string, body: Body) {
  await requireRole(env, projectId, actor.id, "editor");
  const f = await parseTaskFields(env, projectId, body, false);
  const col = await resolveColumn(env, projectId, body.columnId, body.status);
  const order = (f.sort_order as number | undefined) ?? (await nextOrderInColumn(env, col.id));
  const id = newId();
  const res = await env.DB.batch([
    insertTask(env, actor, projectId, f, col, order, nowIso(), id),
    env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id),
    bumpRev(env, projectId)
  ]);
  return { task: toTask(res[1].results[0] as unknown as TaskRow), rev: revFrom(res) };
}

export async function bulkCreateTasks(env: Env, actor: User, projectId: string, list: unknown) {
  await requireRole(env, projectId, actor.id, "editor");
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, "Send a list of tasks.");
  if (list.length > 50) throw new HttpError(400, "Add 50 tasks or fewer at a time.");
  const iso = nowIso();
  const orders: Record<string, number> = {};
  const stmts: D1PreparedStatement[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Each task must be an object.");
    const body = raw as Body;
    const f = await parseTaskFields(env, projectId, body, false);
    const col = await resolveColumn(env, projectId, body.columnId, body.status ?? "backlog");
    orders[col.id] = orders[col.id] ?? (await nextOrderInColumn(env, col.id)) - 1000;
    orders[col.id] += 1000;
    stmts.push(insertTask(env, actor, projectId, f, col, orders[col.id], iso));
  }
  stmts.push(bumpRev(env, projectId));
  const res = await env.DB.batch(stmts);
  return { added: stmts.length - 1, rev: revFrom(res) };
}

export async function updateTask(env: Env, actor: User, taskId: string, body: Body) {
  const task = await loadTask(env, taskId);
  await requireRole(env, task.project_id, actor.id, "editor");
  const f = await parseTaskFields(env, task.project_id, body, true);
  if (body.columnId !== undefined || body.status !== undefined) {
    const col = await resolveColumn(env, task.project_id, body.columnId, body.status);
    if (col.id !== task.column_id || col.category !== task.status) {
      f.column_id = col.id;
      f.status = col.category;
      if (f.sort_order === undefined && col.id !== task.column_id) f.sort_order = await nextOrderInColumn(env, col.id);
    }
  }
  const keys = Object.keys(f);
  if (!keys.length) throw new HttpError(400, "Nothing to change.");
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...keys.map((k) => f[k]), actor.id, nowIso(), task.id),
    env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(task.id),
    bumpRev(env, task.project_id)
  ]);
  return { task: toTask(res[1].results[0] as unknown as TaskRow), before: toTask(task), rev: revFrom(res) };
}

export async function deleteTask(env: Env, actor: User, taskId: string) {
  const task = await loadTask(env, taskId);
  await requireRole(env, task.project_id, actor.id, "editor");
  const files = await env.DB.prepare("SELECT r2_key FROM attachments WHERE task_id = ?").bind(task.id).all<{ r2_key: string }>();
  if (files.results.length) await env.FILES.delete(files.results.map((r) => r.r2_key));
  const res = await env.DB.batch([env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(task.id), bumpRev(env, task.project_id)]);
  return { title: task.title, rev: revFrom(res) };
}

/* Members */

async function ownerCount(env: Env, projectId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner'").bind(projectId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function inviteMember(env: Env, actor: User, projectId: string, body: Body, appUrl: string, defer: (p: Promise<unknown>) => void) {
  await requireRole(env, projectId, actor.id, "owner");
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) throw new HttpError(400, "Type a valid email address.");
  const role = body.role === undefined ? "editor" : oneOf(body.role, "Role", ROLES);
  const project = await env.DB.prepare("SELECT name FROM projects WHERE id = ?").bind(projectId).first<{ name: string }>();
  const iso = nowIso();
  const url = `${appUrl}/p/${projectId}`;
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();

  if (existing) {
    const already = await env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?").bind(projectId, existing.id).first();
    if (already) throw new HttpError(409, "This person is already a member of the project.");
    const res = await env.DB.batch([
      env.DB.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").bind(projectId, existing.id, role, iso),
      // Someone from outside the company joins it as a guest, so they see only this project.
      env.DB.prepare(
        "INSERT OR IGNORE INTO company_members (company_id, user_id, role, created_at) SELECT company_id, ?, 'guest', ? FROM projects WHERE id = ? AND company_id IS NOT NULL"
      ).bind(existing.id, iso, projectId),
      bumpRev(env, projectId)
    ]);
    const mail = inviteEmail(env, { to: email, projectName: project!.name, inviterName: actor.name, role: ROLE_LABELS[role], url, hasAccount: true });
    defer(sendEmail(env, mail).catch((e) => console.error("[openact] invite email failed", e)));
    return { added: "member" as const, email, role, rev: revFrom(res) };
  }

  const res = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO invitations (id, project_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, created_at = excluded.created_at`
    ).bind(newId(), projectId, email, role, actor.id, iso),
    bumpRev(env, projectId)
  ]);
  await sendEmail(env, inviteEmail(env, { to: email, projectName: project!.name, inviterName: actor.name, role: ROLE_LABELS[role], url, hasAccount: false }));
  return { added: "invitation" as const, email, role, rev: revFrom(res) };
}

export async function changeMemberRole(env: Env, actor: User, projectId: string, userId: string, roleIn: unknown) {
  await requireRole(env, projectId, actor.id, "owner");
  const role: Role = oneOf(roleIn, "Role", ROLES);
  const current = await env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?").bind(projectId, userId).first<{ role: Role }>();
  if (!current) throw new HttpError(404, "This person is not a member of the project.");
  if (current.role === "owner" && role !== "owner" && (await ownerCount(env, projectId)) <= 1) {
    throw new HttpError(400, "A project needs at least one owner. Make someone else an owner first.");
  }
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?").bind(role, projectId, userId),
    bumpRev(env, projectId)
  ]);
  return { role, rev: revFrom(res) };
}

export async function removeMember(env: Env, actor: User, projectId: string, userId: string) {
  // Owners can remove anyone. Everyone can leave.
  await requireRole(env, projectId, actor.id, userId === actor.id ? "viewer" : "owner");
  const current = await env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?").bind(projectId, userId).first<{ role: Role }>();
  if (!current) throw new HttpError(404, "This person is not a member of the project.");
  if (current.role === "owner" && (await ownerCount(env, projectId)) <= 1) {
    throw new HttpError(400, "A project needs at least one owner. Make someone else an owner first, or delete the project.");
  }
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").bind(projectId, userId),
    env.DB.prepare("UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?").bind(projectId, userId),
    bumpRev(env, projectId)
  ]);
  return { rev: revFrom(res) };
}
