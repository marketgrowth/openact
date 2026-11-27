import assert from "node:assert/strict";
import { makeDeploy, type Deploy, type Person } from "./deploy.ts";

/*
 * Two companies on one deploy, Alpha and Beta, each with an owner, a member, a project, a task with a note,
 * a board column, an attachment, a workspace and open invitations.
 * Every Alpha value carries the word ALPHASECRET, so a test can see if any of it reaches a Beta person.
 */

export const MARK = "ALPHASECRET";

export type Side = {
  owner: Person;
  member: Person;
  companyId: string;
  projectId: string;
  taskId: string;
  columnId: string;
  attachmentId: string;
  workspaceId: string;
  projectInvitationId: string;
  companyInvitationId: string;
};

async function ok(p: Promise<{ status: number; text: string; json: Record<string, unknown> | null }>, what: string) {
  const r = await p;
  assert.ok(r.status >= 200 && r.status < 300, `${what}: ${r.status} ${r.text}`);
  return r.json ?? {};
}

/** True when the deploy has the Projects app. Some deploys, such as a store, run without it. */
export const hasProjects = (d: Deploy) => d.app.routes.some((r) => r.path === "/api/projects");

/** Ids for Projects data on a deploy without Projects. Calls with them get 404. */
const NO_PROJECTS = "00000000-0000-4000-8000-000000000000";

async function seed(d: Deploy, tag: string, word: string): Promise<Side> {
  const owner = d.person(`${tag}-owner@${tag}.test`, `${word} Owner`);
  const member = d.person(`${tag}-member@${tag}.test`, `${word} Member`);
  await ok(d.call(owner, "POST", "/api/companies", { name: `${word} Company` }), `${tag} company`);
  const companyId = d.one<{ id: string }>("SELECT company_id AS id FROM company_members WHERE user_id = ?", owner.id).id;
  await d.join(owner, companyId, member);
  await ok(d.call(owner, "POST", `/api/companies/${companyId}/members`, { email: `${tag}-pending@${tag}.test` }), `${tag} company invite`);
  await ok(d.call(owner, "POST", `/api/companies/${companyId}/workspaces`, { name: `${word} Workspace`, kind: "brand" }), `${tag} workspace`);
  const workspaceId = d.one<{ id: string }>("SELECT id FROM workspaces WHERE company_id = ? AND name = ?", companyId, `${word} Workspace`).id;
  const companyInvitationId = d.one<{ id: string }>("SELECT id FROM company_invitations WHERE company_id = ?", companyId).id;
  if (!hasProjects(d)) {
    const none = NO_PROJECTS;
    return { owner, member, companyId, projectId: none, taskId: none, columnId: none, attachmentId: none, workspaceId, projectInvitationId: none, companyInvitationId };
  }
  const project = await ok(d.call(owner, "POST", "/api/projects", { name: `${word} Project`, companyId }), `${tag} project`);
  const projectId = ((project.project as { id?: string } | undefined)?.id ?? project.id) as string;
  await ok(d.call(owner, "POST", `/api/projects/${projectId}/tasks`, { title: `${word} Task`, notes: `${word} private note` }), `${tag} task`);
  await ok(d.call(owner, "POST", `/api/projects/${projectId}/columns`, { name: `${word} Column` }), `${tag} column`);
  await ok(d.call(owner, "POST", `/api/projects/${projectId}/members`, { email: `${tag}-guest@${tag}.test`, role: "viewer" }), `${tag} project invite`);
  const taskId = d.one<{ id: string }>("SELECT id FROM tasks WHERE project_id = ? AND title = ?", projectId, `${word} Task`).id;
  const form = new FormData();
  form.set("file", new File([`${word} file body`], `${word}-file.txt`, { type: "text/plain" }));
  await ok(d.call(owner, "POST", `/api/tasks/${taskId}/attachments`, form), `${tag} attachment`);
  return {
    owner,
    member,
    companyId,
    projectId,
    taskId,
    columnId: d.one<{ id: string }>("SELECT id FROM board_columns WHERE project_id = ? AND name = ?", projectId, `${word} Column`).id,
    attachmentId: d.one<{ id: string }>("SELECT id FROM attachments WHERE task_id = ?", taskId).id,
    workspaceId,
    projectInvitationId: d.one<{ id: string }>("SELECT id FROM invitations WHERE project_id = ?", projectId).id,
    companyInvitationId
  };
}

/** A deploy with the Alpha and Beta companies. */
export async function twoCompanies(vars: Record<string, string> = {}) {
  const d = makeDeploy(vars);
  const alpha = await seed(d, "alpha", MARK);
  const beta = await seed(d, "beta", "Beta");
  return { d, alpha, beta };
}

/** Everything that belongs to Alpha, to compare before and after the cross-company calls. */
export function alphaSnapshot(d: Deploy, alpha: Side): string {
  const rows = [
    d.all("SELECT * FROM companies WHERE id = ?", alpha.companyId),
    d.all("SELECT user_id, role FROM company_members WHERE company_id = ? ORDER BY user_id", alpha.companyId),
    d.all("SELECT id, email, role FROM company_invitations WHERE company_id = ? ORDER BY id", alpha.companyId),
    d.all("SELECT id, name, is_default, archived_at FROM workspaces WHERE company_id = ? ORDER BY id", alpha.companyId),
    d.all("SELECT * FROM company_apps WHERE company_id = ? ORDER BY app_id", alpha.companyId),
    d.all("SELECT * FROM company_ai WHERE company_id = ?", alpha.companyId)
  ];
  if (!hasProjects(d)) return JSON.stringify(rows);
  rows.push(
    d.all("SELECT id, name, description, color, visibility, ai_policy, workspace_id FROM projects WHERE company_id = ? ORDER BY id", alpha.companyId),
    d.all("SELECT user_id, role FROM project_members WHERE project_id = ? ORDER BY user_id", alpha.projectId),
    d.all("SELECT id, email, role FROM invitations WHERE project_id = ? ORDER BY id", alpha.projectId),
    d.all("SELECT id, title, notes, status, priority, column_id, assignee_id FROM tasks WHERE project_id = ? ORDER BY id", alpha.projectId),
    d.all("SELECT id, name FROM board_columns WHERE project_id = ? ORDER BY id", alpha.projectId),
    d.all("SELECT id, filename FROM attachments WHERE project_id = ? ORDER BY id", alpha.projectId)
  );
  return JSON.stringify(rows);
}
