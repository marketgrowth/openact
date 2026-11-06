import type { Env } from "./env";
import type { Attachment, Column, CompanyRole, Priority, Role, Status, Task, Visibility } from "../shared/types";
import { effectiveProjectRole } from "../shared/access";
import { markProjectChanged } from "./live";
import { HttpError, nowIso } from "./util";

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export interface ProjectAccess {
  role: Role | null;
  projectRole: Role | null;
  companyId: string | null;
  companyRole: CompanyRole | null;
  visibility: Visibility;
}

/** How a person can reach a project, through the project and through its company. null when the project does not exist. */
export async function projectAccess(env: Env, projectId: string, userId: string): Promise<ProjectAccess | null> {
  const row = await env.DB.prepare(
    `SELECT p.visibility, p.company_id, pm.role AS project_role, cm.role AS company_role
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN company_members cm ON cm.company_id = p.company_id AND cm.user_id = ?
     WHERE p.id = ?`
  )
    .bind(userId, userId, projectId)
    .first<{ visibility: Visibility; company_id: string | null; project_role: Role | null; company_role: CompanyRole | null }>();
  if (!row) return null;
  const a = { visibility: row.visibility, projectRole: row.project_role, companyRole: row.company_role };
  return { ...a, companyId: row.company_id, role: effectiveProjectRole(a) };
}

/**
 * Checks that the person can reach the project with at least `min`. Returns their effective role.
 * 404 when the project does not exist. 403 with code "no_access" when it exists but they cannot open it.
 */
export async function requireRole(env: Env, projectId: string, userId: string, min: Role): Promise<Role> {
  const access = await projectAccess(env, projectId, userId);
  if (!access) throw new HttpError(404, "This project does not exist.");
  if (!access.role) throw new HttpError(403, "You do not have access to this project. You can ask an owner for access.", "no_access");
  if (RANK[access.role] < RANK[min]) {
    throw new HttpError(403, min === "owner" ? "Only a project owner can do this." : "Your role in this project is view only.");
  }
  return access.role;
}

/** The company role of a person, or null. */
export async function companyRole(env: Env, companyId: string, userId: string): Promise<CompanyRole | null> {
  const row = await env.DB.prepare("SELECT role FROM company_members WHERE company_id = ? AND user_id = ?").bind(companyId, userId).first<{ role: CompanyRole }>();
  return row?.role ?? null;
}

/** Checks the company role. Guests and outsiders get 404, so a company id reveals nothing. */
export async function requireCompanyRole(env: Env, companyId: string, userId: string, allowed: CompanyRole[]): Promise<CompanyRole> {
  const role = await companyRole(env, companyId, userId);
  if (!role) throw new HttpError(404, "This company does not exist, or you are not in it.");
  if (!allowed.includes(role)) {
    throw new HttpError(403, allowed.includes("admin") ? "Only company owners and admins can do this." : allowed.includes("member") ? "Guests cannot do this. Ask a company admin to make you a member." : "Only a company owner can do this.");
  }
  return role;
}

/** Projects the person can see in a company, newest first. */
export async function visibleProjectIds(env: Env, companyId: string, userId: string): Promise<Array<{ id: string; name: string; role: Role; isMember: boolean }>> {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.name, p.visibility, pm.role AS project_role, cm.role AS company_role
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN company_members cm ON cm.company_id = p.company_id AND cm.user_id = ?
     WHERE p.company_id = ?
     ORDER BY p.updated_at DESC`
  )
    .bind(userId, userId, companyId)
    .all<{ id: string; name: string; visibility: Visibility; project_role: Role | null; company_role: CompanyRole | null }>();
  const out: Array<{ id: string; name: string; role: Role; isMember: boolean }> = [];
  for (const r of rows.results) {
    const role = effectiveProjectRole({ visibility: r.visibility, projectRole: r.project_role, companyRole: r.company_role });
    if (role) out.push({ id: r.id, name: r.name, role, isMember: !!r.project_role });
  }
  return out;
}

/** A statement that marks the project as changed. Clients poll `rev` to know when to reload. */
export function bumpRev(env: Env, projectId: string): D1PreparedStatement {
  markProjectChanged(projectId);
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
  column_id: string | null;
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
    columnId: r.column_id,
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

/** True when the person can open the project, through the project or its company. */
export async function isMember(env: Env, projectId: string, userId: string): Promise<boolean> {
  return !!(await projectAccess(env, projectId, userId))?.role;
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

export interface ColumnRow {
  id: string;
  project_id: string;
  name: string;
  category: Status;
  position: number;
}

export const toColumn = (r: ColumnRow): Column => ({ id: r.id, name: r.name, category: r.category, position: r.position });

export async function loadColumns(env: Env, projectId: string): Promise<ColumnRow[]> {
  const rows = await env.DB.prepare("SELECT id, project_id, name, category, position FROM board_columns WHERE project_id = ? ORDER BY position").bind(projectId).all<ColumnRow>();
  return rows.results;
}
