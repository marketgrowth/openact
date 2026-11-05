import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { MAX_ATTACHMENT_BYTES, PRIORITY_IDS, STATUS_IDS, type Status } from "../shared/types";
import { bumpRev, isMember, nextOrder, requireRole, revFrom, toAttachment, toTask, type AttachmentRow, type TaskRow } from "./data";
import { HttpError, dateOrNull, newId, nowIso, num, oneOf, readJson, requireUser, text } from "./util";

/** Checks task fields. With `partial`, only the fields that are present are checked. */
async function parseTaskFields(env: Env, projectId: string, body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) out.title = text(body.title, "Title", { max: 140, required: true });
  if (body.notes !== undefined) out.notes = text(body.notes, "Notes", { max: 8000 });
  if (body.status !== undefined) out.status = oneOf(body.status, "Status", STATUS_IDS);
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

async function loadTask(env: Env, taskId: string): Promise<TaskRow> {
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<TaskRow>();
  if (!row) throw new HttpError(404, "This task does not exist. Someone may have deleted it.");
  return row;
}

/* Routes under /api/projects/:id/tasks */

export const projectTaskRoutes = new Hono<AppEnv>();

projectTaskRoutes.post("/:id/tasks", async (c) => {
  const user = requireUser(c);
  const projectId = c.req.param("id");
  await requireRole(c.env, projectId, user.id, "editor");
  const f = await parseTaskFields(c.env, projectId, await readJson(c), false);
  const status = (f.status as Status) ?? "todo";
  const iso = nowIso();
  const id = newId();
  const order = (f.sort_order as number | undefined) ?? (await nextOrder(c.env, projectId, status));
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tasks (id, project_id, title, notes, status, priority, phase, start_date, end_date, assignee_id, sort_order, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      projectId,
      f.title,
      f.notes ?? "",
      status,
      f.priority ?? "med",
      f.phase ?? "",
      f.start_date ?? null,
      f.end_date ?? null,
      f.assignee_id ?? null,
      order,
      user.id,
      user.id,
      iso,
      iso
    ),
    c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id),
    bumpRev(c.env, projectId)
  ]);
  return c.json({ task: toTask(res[1].results[0] as unknown as TaskRow), rev: revFrom(res) }, 201);
});

/** Adds many tasks at once, for example a plan drafted with AI. */
projectTaskRoutes.post("/:id/tasks/bulk", async (c) => {
  const user = requireUser(c);
  const projectId = c.req.param("id");
  await requireRole(c.env, projectId, user.id, "editor");
  const body = await readJson(c);
  if (!Array.isArray(body.tasks) || !body.tasks.length) throw new HttpError(400, "Send a list of tasks.");
  if (body.tasks.length > 50) throw new HttpError(400, "Add 50 tasks or fewer at a time.");
  const iso = nowIso();
  const orders: Partial<Record<Status, number>> = {};
  const stmts: D1PreparedStatement[] = [];
  for (const raw of body.tasks) {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Each task must be an object.");
    const f = await parseTaskFields(c.env, projectId, raw as Record<string, unknown>, false);
    const status = (f.status as Status) ?? "backlog";
    orders[status] = orders[status] ?? (await nextOrder(c.env, projectId, status)) - 1000;
    orders[status]! += 1000;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO tasks (id, project_id, title, notes, status, priority, phase, start_date, end_date, assignee_id, sort_order, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        newId(),
        projectId,
        f.title,
        f.notes ?? "",
        status,
        f.priority ?? "med",
        f.phase ?? "",
        f.start_date ?? null,
        f.end_date ?? null,
        f.assignee_id ?? null,
        orders[status]!,
        user.id,
        user.id,
        iso,
        iso
      )
    );
  }
  stmts.push(bumpRev(c.env, projectId));
  const res = await c.env.DB.batch(stmts);
  return c.json({ added: stmts.length - 1, rev: revFrom(res) }, 201);
});

/* Routes under /api/tasks */

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.patch("/:taskId", async (c) => {
  const user = requireUser(c);
  const task = await loadTask(c.env, c.req.param("taskId"));
  await requireRole(c.env, task.project_id, user.id, "editor");
  const f = await parseTaskFields(c.env, task.project_id, await readJson(c), true);
  if (f.status !== undefined && f.status !== task.status && f.sort_order === undefined) {
    f.sort_order = await nextOrder(c.env, task.project_id, f.status as Status);
  }
  const keys = Object.keys(f);
  if (!keys.length) throw new HttpError(400, "Nothing to change.");
  const res = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(
      ...keys.map((k) => f[k]),
      user.id,
      nowIso(),
      task.id
    ),
    c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(task.id),
    bumpRev(c.env, task.project_id)
  ]);
  return c.json({ task: toTask(res[1].results[0] as unknown as TaskRow), rev: revFrom(res) });
});

taskRoutes.delete("/:taskId", async (c) => {
  const user = requireUser(c);
  const task = await loadTask(c.env, c.req.param("taskId"));
  await requireRole(c.env, task.project_id, user.id, "editor");
  const files = await c.env.DB.prepare("SELECT r2_key FROM attachments WHERE task_id = ?").bind(task.id).all<{ r2_key: string }>();
  if (files.results.length) await c.env.FILES.delete(files.results.map((r) => r.r2_key));
  const res = await c.env.DB.batch([c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(task.id), bumpRev(c.env, task.project_id)]);
  return c.json({ rev: revFrom(res) });
});

/* Attachments, stored in R2 */

function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f\u007f"]/g, "_").trim().slice(0, 150);
  return cleaned || "file";
}

taskRoutes.post("/:taskId/attachments", async (c) => {
  const user = requireUser(c);
  const task = await loadTask(c.env, c.req.param("taskId"));
  await requireRole(c.env, task.project_id, user.id, "editor");
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size === 0) throw new HttpError(400, "The file is empty.");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "The file is too large. The limit is 25 MB.");
  const id = newId();
  const filename = safeFilename(file.name);
  const contentType = (file.type || "application/octet-stream").slice(0, 120);
  const key = `projects/${task.project_id}/tasks/${task.id}/${id}`;
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType }, customMetadata: { filename } });
  const iso = nowIso();
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO attachments (id, project_id, task_id, r2_key, filename, content_type, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, task.project_id, task.id, key, filename, contentType, file.size, user.id, iso),
    c.env.DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(id),
    bumpRev(c.env, task.project_id)
  ]);
  return c.json({ attachment: toAttachment(res[1].results[0] as unknown as AttachmentRow), rev: revFrom(res) }, 201);
});

export const attachmentRoutes = new Hono<AppEnv>();

async function loadAttachment(env: Env, id: string): Promise<AttachmentRow> {
  const row = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<AttachmentRow>();
  if (!row) throw new HttpError(404, "This file does not exist. Someone may have deleted it.");
  return row;
}

attachmentRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const att = await loadAttachment(c.env, c.req.param("id"));
  await requireRole(c.env, att.project_id, user.id, "viewer");
  const obj = await c.env.FILES.get(att.r2_key);
  if (!obj) throw new HttpError(404, "The file is missing from storage.");
  // Always download, never render inline, so an uploaded HTML file cannot run on this origin.
  return new Response(obj.body, {
    headers: {
      "Content-Type": att.content_type,
      "Content-Length": String(att.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0, no-store"
    }
  });
});

attachmentRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  const att = await loadAttachment(c.env, c.req.param("id"));
  await requireRole(c.env, att.project_id, user.id, "editor");
  await c.env.FILES.delete(att.r2_key);
  const res = await c.env.DB.batch([c.env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(att.id), bumpRev(c.env, att.project_id)]);
  return c.json({ rev: revFrom(res) });
});
