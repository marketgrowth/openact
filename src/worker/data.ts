import type { Env } from "./env";
import type { Attachment, Priority, Role, Status, Task } from "../shared/types";
import { HttpError, nowIso } from "./util";

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

/** Returns the person's role in the project, or throws 404/403. Non-members get 404 so project ids do not leak. */
export async function requireRole(env: Env, projectId: string, userId: string, min: Role): Promise<Role> {
  const row = await env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<{ role: Role }>();
  if (!row) throw new HttpError(404, "This project does not exist, or you do not have access to it.");
  if (RANK[row.role] < RANK[min]) {
    throw new HttpError(403, min === "owner" ? "Only a project owner can do this." : "Your role in this project is view only.");
  }
  return row.role;
}

/** A statement that marks the project as changed. Clients poll `rev` to know when to reload. */
export function bumpRev(env: Env, projectId: string): D1PreparedStatement {
  return env.DB.prepare("UPDATE projects SET rev = rev + 1, updated_at = ? WHERE id = ? RETURNING rev").bind(nowIso(), projectId);
}

export function revFrom(results: D1Result[]): number {
  const last = results[results.length - 1];
  const row = (last?.results?.[0] ?? null) as { rev?: number } | null;
  return row?.rev ?? 0;
}

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  notes: string;
  status: Status;
  priority: Priority;
  phase: string;
  start_date: string | null;
  end_date: string | null;
  assignee_id: string | null;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    notes: r.notes,
    status: r.status,
    priority: r.priority,
    phase: r.phase,
    start: r.start_date,
    end: r.end_date,
    assigneeId: r.assignee_id,
    order: r.sort_order,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export interface AttachmentRow {
  id: string;
  task_id: string;
  project_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_by: string | null;
  created_at: string;
}

export function toAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    taskId: r.task_id,
    filename: r.filename,
    contentType: r.content_type,
    size: r.size,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at
  };
}

export async function nextOrder(env: Env, projectId: string, status: Status): Promise<number> {
  const row = await env.DB.prepare("SELECT MAX(sort_order) AS m FROM tasks WHERE project_id = ? AND status = ?")
    .bind(projectId, status)
    .first<{ m: number | null }>();
  return (row?.m ?? 0) + 1000;
}

export async function isMember(env: Env, projectId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?").bind(projectId, userId).first();
  return !!row;
}

/** Deletes every R2 object under a prefix. Used when a project is deleted. */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor, limit: 1000 });
    if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
