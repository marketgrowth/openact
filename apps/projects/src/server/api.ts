import type { Env } from "./env";
import {
  PRIORITY_IDS,
  PROJECT_COLORS,
  ROLES,
  STATUS_IDS,
  VISIBILITIES,
  type Priority,
  type ProjectColor,
  type Role,
  type Status,
  type Visibility
} from "../shared/types";
import { parsePolicy } from "../shared/agent-policy";
import { defaultColumnStatements } from "./services";
import { HttpError, dateOrNull, newId, nowIso, oneOf, text } from "./util";

/*
 * What other apps may use from the Projects app on the server: import "@openact/app-projects/api".
 * An app that uses it lists "projects" in "requiresApps" in its package.json.
 *
 * These functions do not check the caller's access. The calling app checks its own permission first,
 * for example Advisory checks that a payment is confirmed before it opens an engagement project.
 */

export interface NewProject {
  companyId: string;
  /** A workspace of the company. Default: the company's default workspace. */
  workspaceId?: string;
  name: string;
  description?: string;
  color?: ProjectColor;
  /** Default: "secret", so only the members see it. */
  visibility?: Visibility;
  /** The project owner. */
  ownerId: string;
  /** More people on the project. A person who is not in the company joins it as a guest, so they see only this project. */
  members?: Array<{ userId: string; role: Role }>;
  /** Tasks to start the project with, in order. At most MAX_NEW_TASKS. */
  tasks?: NewTask[];
}

/** A task that createProject adds. The owner is its author. */
export interface NewTask {
  /** 140 characters or fewer. */
  title: string;
  /** A group for the task, such as a step of a plan. 60 characters or fewer. */
  phase?: string;
  /** 8000 characters or fewer. */
  notes?: string;
  /** Default: "todo". The task goes to the first column of its status. */
  status?: Status;
  /** Default: "med". */
  priority?: Priority;
  /** Dates like 2026-11-05. The end date cannot be before the start date. */
  startDate?: string;
  endDate?: string;
}

/** The most tasks createProject adds in one call. */
export const MAX_NEW_TASKS = 200;

type CleanTask = Required<Pick<NewTask, "title" | "phase" | "notes" | "status" | "priority">> & { startDate: string | null; endDate: string | null };

/** Checks the tasks before anything is written, so a bad task makes no project. */
function cleanTasks(tasks: NewTask[] | undefined): CleanTask[] {
  if (tasks === undefined) return [];
  if (!Array.isArray(tasks)) throw new HttpError(400, "The tasks must be a list.");
  if (tasks.length > MAX_NEW_TASKS) throw new HttpError(400, `A new project can start with ${MAX_NEW_TASKS} tasks or fewer.`);
  return tasks.map((t, i) => {
    const n = `Task ${i + 1}`;
    if (!t || typeof t !== "object") throw new HttpError(400, `${n} is not valid.`);
    const startDate = dateOrNull(t.startDate, `${n} start date`);
    const endDate = dateOrNull(t.endDate, `${n} end date`);
    if (startDate && endDate && endDate < startDate) throw new HttpError(400, `${n} ends before it starts. Change the dates.`);
    return {
      title: text(t.title, `${n} title`, { max: 140, required: true }),
      phase: text(t.phase, `${n} phase`, { max: 60 }),
      notes: text(t.notes, `${n} notes`, { max: 8000 }),
      status: t.status === undefined ? "todo" : oneOf(t.status, `${n} status`, STATUS_IDS),
      priority: t.priority === undefined ? "med" : oneOf(t.priority, `${n} priority`, PRIORITY_IDS),
      startDate,
      endDate
    };
  });
}

/** The project's path in the web app. */
export const projectPath = (projectId: string) => `/p/${projectId}`;

/** Statements that make a project with the default columns and its first members. Projects uses them too. */
export function newProjectStatements(env: Env, p: NewProject & { id: string; aiDefaults: string | null | undefined; createdBy: string }) {
  const iso = nowIso();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      // Without a workspace, a trigger puts the project in the company's default workspace.
      "INSERT INTO projects (id, name, description, color, company_id, workspace_id, visibility, ai_policy, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      p.id,
      p.name,
      p.description ?? "",
      p.color ?? "indigo",
      p.companyId,
      p.workspaceId ?? null,
      p.visibility ?? "secret",
      JSON.stringify(parsePolicy(p.aiDefaults)),
      p.createdBy,
      iso,
      iso
    ),
    env.DB.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(p.id, p.ownerId, iso)
  ];
  for (const m of p.members ?? []) {
    if (m.userId === p.ownerId) continue;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role"
      ).bind(p.id, m.userId, m.role, iso),
      env.DB.prepare("INSERT OR IGNORE INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'guest', ?)").bind(p.companyId, m.userId, iso)
    );
  }
  const cols = defaultColumnStatements(env, p.id);
  stmts.push(...cols.stmts);
  return { stmts, columnIds: cols.ids };
}

/**
 * Makes a project for another app, such as an Advisory engagement.
 * The project starts with the company's AI defaults, and with the given tasks or none.
 * The project, its members and its tasks are written in one batch: all of them, or nothing.
 */
export async function createProject(env: Env, p: NewProject): Promise<{ id: string; path: string }> {
  const name = p.name.trim().slice(0, 80);
  if (!name) throw new HttpError(400, "The project needs a name.");
  if (p.color && !PROJECT_COLORS.includes(p.color)) throw new HttpError(400, "The project color is not valid.");
  if (p.visibility && !VISIBILITIES.includes(p.visibility)) throw new HttpError(400, "The project visibility is not valid.");
  for (const m of p.members ?? []) if (!ROLES.includes(m.role)) throw new HttpError(400, "A project role is not valid.");
  const tasks = cleanTasks(p.tasks);
  const co = await env.DB.prepare("SELECT ai_defaults FROM companies WHERE id = ?").bind(p.companyId).first<{ ai_defaults: string }>();
  if (!co) throw new HttpError(404, "This company does not exist.");
  if (p.workspaceId) {
    const ws = await env.DB.prepare("SELECT id FROM workspaces WHERE id = ? AND company_id = ? AND archived_at IS NULL").bind(p.workspaceId, p.companyId).first();
    if (!ws) throw new HttpError(400, "This workspace does not exist in the company, or it was archived.");
  }
  const id = newId();
  const { stmts, columnIds } = newProjectStatements(env, { ...p, name, description: (p.description ?? "").slice(0, 500), id, aiDefaults: co.ai_defaults, createdBy: p.ownerId });
  // Tasks keep the given order inside each column, the same way the "Example plan" template does it.
  const iso = nowIso();
  const orders: Partial<Record<Status, number>> = {};
  for (const t of tasks) {
    orders[t.status] = (orders[t.status] ?? 0) + 1000;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO tasks (id, project_id, column_id, title, notes, status, priority, phase, start_date, end_date, sort_order, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId(), id, columnIds[t.status], t.title, t.notes, t.status, t.priority, t.phase, t.startDate, t.endDate, orders[t.status], p.ownerId, p.ownerId, iso, iso)
    );
  }
  await env.DB.batch(stmts);
  return { id, path: projectPath(id) };
}

/** True when the project still exists. */
export async function projectExists(env: Env, projectId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 AS x FROM projects WHERE id = ?").bind(projectId).first());
}
