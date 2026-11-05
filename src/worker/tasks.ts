import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { MAX_ATTACHMENT_BYTES } from "../shared/types";
import { bumpRev, requireRole, revFrom, toAttachment, type AttachmentRow, type TaskRow } from "./data";
import { bulkCreateTasks, createColumn, createTask, deleteColumn, deleteTask, updateColumn, updateTask } from "./services";
import { HttpError, newId, nowIso, readJson, requireUser } from "./util";

/* Routes under /api/projects/:id/tasks and /api/projects/:id/columns */

export const projectTaskRoutes = new Hono<AppEnv>();

projectTaskRoutes.post("/:id/tasks", async (c) => c.json(await createTask(c.env, requireUser(c), c.req.param("id"), await readJson(c)), 201));

/** Adds many tasks at once, for example a plan drafted with AI. */
projectTaskRoutes.post("/:id/tasks/bulk", async (c) => c.json(await bulkCreateTasks(c.env, requireUser(c), c.req.param("id"), (await readJson(c)).tasks), 201));

projectTaskRoutes.post("/:id/columns", async (c) => c.json(await createColumn(c.env, requireUser(c), c.req.param("id"), await readJson(c)), 201));

/* Routes under /api/tasks */

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.patch("/:taskId", async (c) => {
  const { task, rev } = await updateTask(c.env, requireUser(c), c.req.param("taskId"), await readJson(c));
  return c.json({ task, rev });
});

taskRoutes.delete("/:taskId", async (c) => {
  const { rev } = await deleteTask(c.env, requireUser(c), c.req.param("taskId"));
  return c.json({ rev });
});

/* Routes under /api/columns */

export const columnRoutes = new Hono<AppEnv>();

columnRoutes.patch("/:columnId", async (c) => c.json(await updateColumn(c.env, requireUser(c), c.req.param("columnId"), await readJson(c))));

columnRoutes.delete("/:columnId", async (c) => {
  const moveTo = c.req.query("moveTo");
  return c.json(await deleteColumn(c.env, requireUser(c), c.req.param("columnId"), moveTo));
});

async function loadTask(env: Env, taskId: string): Promise<TaskRow> {
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<TaskRow>();
  if (!row) throw new HttpError(404, "This task does not exist. Someone may have deleted it.");
  return row;
}

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
