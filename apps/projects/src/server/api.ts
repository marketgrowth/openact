import type { Env } from "./env";
import { PROJECT_COLORS, ROLES, VISIBILITIES, type ProjectColor, type Role, type Visibility } from "../shared/types";
import { parsePolicy } from "../shared/agent-policy";
import { defaultColumnStatements } from "./services";
import { HttpError, newId, nowIso } from "./util";

/*
 * What other apps may use from the Projects app on the server: import "@openact/app-projects/api".
 * An app that uses it lists "projects" in "requiresApps" in its package.json.
 *
 * These functions do not check the caller's access. The calling app checks its own permission first,
 * for example Advisory checks that a payment is confirmed before it opens an engagement project.
 */

export interface NewProject {
  companyId: string;
  name: string;
  description?: string;
  color?: ProjectColor;
  /** Default: "secret", so only the members see it. */
  visibility?: Visibility;
  /** The project owner. */
  ownerId: string;
  /** More people on the project. A person who is not in the company joins it as a guest, so they see only this project. */
  members?: Array<{ userId: string; role: Role }>;
}

/** The project's path in the web app. */
export const projectPath = (projectId: string) => `/p/${projectId}`;

/** Statements that make a project with the default columns and its first members. Projects uses them too. */
export function newProjectStatements(env: Env, p: NewProject & { id: string; aiDefaults: string | null | undefined; createdBy: string }) {
  const iso = nowIso();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO projects (id, name, description, color, company_id, visibility, ai_policy, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(p.id, p.name, p.description ?? "", p.color ?? "indigo", p.companyId, p.visibility ?? "secret", JSON.stringify(parsePolicy(p.aiDefaults)), p.createdBy, iso, iso),
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
 * The project starts empty, with the company's AI defaults.
 */
export async function createProject(env: Env, p: NewProject): Promise<{ id: string; path: string }> {
  const name = p.name.trim().slice(0, 80);
  if (!name) throw new HttpError(400, "The project needs a name.");
  if (p.color && !PROJECT_COLORS.includes(p.color)) throw new HttpError(400, "The project color is not valid.");
  if (p.visibility && !VISIBILITIES.includes(p.visibility)) throw new HttpError(400, "The project visibility is not valid.");
  for (const m of p.members ?? []) if (!ROLES.includes(m.role)) throw new HttpError(400, "A project role is not valid.");
  const co = await env.DB.prepare("SELECT ai_defaults FROM companies WHERE id = ?").bind(p.companyId).first<{ ai_defaults: string }>();
  if (!co) throw new HttpError(404, "This company does not exist.");
  const id = newId();
  const { stmts } = newProjectStatements(env, { ...p, name, description: (p.description ?? "").slice(0, 500), id, aiDefaults: co.ai_defaults, createdBy: p.ownerId });
  await env.DB.batch(stmts);
  return { id, path: projectPath(id) };
}

/** True when the project still exists. */
export async function projectExists(env: Env, projectId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 AS x FROM projects WHERE id = ?").bind(projectId).first());
}
