import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import {
  COMPANY_ROLES,
  PROJECT_COLORS,
  ROLES,
  VISIBILITIES,
  type AccessRequest,
  type Visibility,
  type Invitation,
  type Member,
  type ProjectColor,
  type ProjectDetail,
  type ProjectSummary,
  type RecentTask,
  type Role
} from "../shared/types";
import { AGENT_LEVELS, AGENT_SCOPES, type AgentAction, type AgentLevel, type AiPolicy } from "../shared/types";
import { ROLE_CEILING, effectiveLevel, levelRank, parsePolicy } from "../shared/agent-policy";
import { bumpRev, deletePrefix, projectAccess, requireCompanyRole, requireRole, revFrom, toAttachment, toColumn, toTask, visibleProjectIds, type AttachmentRow, type TaskRow } from "./data";
import { currentCompanyId } from "./companies";
import { accessGrantedEmail, accessRequestEmail, sendEmail } from "./email";
import { reindexProjectStatement } from "./search";
import { markProjectChanged } from "./live";
import { changeMemberRole, defaultColumnStatements, inviteMember, removeMember } from "./services";
import { HttpError, addDays, appUrl, newId, nowIso, oneOf, readJson, requireAppOn, requirePermission, requireUser, text, todayIso } from "./util";

export const projectRoutes = new Hono<AppEnv>();

/** Projects the person can see in one company. ?company=ID, or their current company. */
projectRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.query("company") || (await currentCompanyId(c.env, user.id));
  if (!companyId) return c.json({ companyId: null, projects: [], recentTasks: [] });
  await requireCompanyRole(c.env, companyId, user.id, [...COMPANY_ROLES]);
  await requireAppOn(c.env, companyId, "projects");
  const visible = await visibleProjectIds(c.env, companyId, user.id);
  if (!visible.length) return c.json({ companyId, projects: [], recentTasks: [] });
  const byId = new Map(visible.map((v) => [v.id, v]));
  const marks = visible.map(() => "?").join(", ");
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.description, p.color, p.visibility, p.updated_at,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.end_date < ?) AS late_count,
       (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
     FROM projects p WHERE p.id IN (${marks})
     ORDER BY p.updated_at DESC`
  )
    .bind(todayIso(), ...visible.map((v) => v.id))
    .all<{ id: string; name: string; description: string; color: ProjectColor; visibility: Visibility; updated_at: string; task_count: number; done_count: number; late_count: number; member_count: number }>();
  // The person's own pins and recent tasks, only for projects they can still see.
  const ids = visible.map((v) => v.id);
  const [pinRows, recentRows] = await Promise.all([
    c.env.DB.prepare(`SELECT project_id, created_at FROM projects_pins WHERE user_id = ? AND project_id IN (${marks})`)
      .bind(user.id, ...ids)
      .all<{ project_id: string; created_at: string }>(),
    c.env.DB.prepare(
      `SELECT r.task_id, r.project_id, r.opened_at, t.title FROM projects_recent_tasks r JOIN tasks t ON t.id = r.task_id
       WHERE r.user_id = ? AND r.project_id IN (${marks}) ORDER BY r.opened_at DESC LIMIT ${RECENT_SHOWN}`
    )
      .bind(user.id, ...ids)
      .all<{ task_id: string; project_id: string; opened_at: string; title: string }>()
  ]);
  const pins = new Map(pinRows.results.map((r) => [r.project_id, r.created_at]));
  const recentTasks: RecentTask[] = recentRows.results.map((r) => ({ taskId: r.task_id, projectId: r.project_id, title: r.title, openedAt: r.opened_at }));
  const projects: ProjectSummary[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    role: byId.get(r.id)!.role,
    visibility: r.visibility,
    isMember: byId.get(r.id)!.isMember,
    taskCount: r.task_count,
    doneCount: r.done_count,
    lateCount: r.late_count,
    memberCount: r.member_count,
    updatedAt: r.updated_at,
    pinnedAt: pins.get(r.id) ?? null
  }));
  return c.json({ companyId, projects, recentTasks });
});

/** How many recent tasks the side panel shows, and how many the server keeps per person. */
const RECENT_SHOWN = 8;
const RECENT_KEPT = 20;

/* Pins and recent tasks belong to one person. They need only view access, and they never bump the project's revision. */

projectRoutes.put("/:id/pin", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "viewer");
  await c.env.DB.prepare("INSERT OR IGNORE INTO projects_pins (user_id, project_id, created_at) VALUES (?, ?, ?)").bind(user.id, id, nowIso()).run();
  return c.json({ pinned: true });
});

projectRoutes.delete("/:id/pin", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare("DELETE FROM projects_pins WHERE user_id = ? AND project_id = ?").bind(user.id, c.req.param("id")).run();
  return c.json({ pinned: false });
});

/** Records that the person opened a task, for the Recent list. */
projectRoutes.post("/:id/tasks/:taskId/opened", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const taskId = c.req.param("taskId");
  await requireRole(c.env, id, user.id, "viewer");
  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ?").bind(taskId, id).first();
  if (!task) throw new HttpError(404, "This task does not exist in this project. It may have been deleted.");
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO projects_recent_tasks (user_id, task_id, project_id, opened_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, task_id) DO UPDATE SET opened_at = excluded.opened_at`
    ).bind(user.id, taskId, id, nowIso()),
    c.env.DB.prepare(
      `DELETE FROM projects_recent_tasks WHERE user_id = ? AND task_id NOT IN
         (SELECT task_id FROM projects_recent_tasks WHERE user_id = ? ORDER BY opened_at DESC LIMIT ${RECENT_KEPT})`
    ).bind(user.id, user.id)
  ]);
  return c.json({ ok: true });
});

/** Sample tasks for the "Example plan" template. Offsets are in days from the start date. */
const EXAMPLE_TASKS: Array<[string, string, string, string, number, number, string]> = [
  // title, phase, status, priority, start offset, length in days, notes
  ["Interview five customers", "Discovery", "done", "high", 0, 5, "Ask what they use the site for. Record the top three problems."],
  ["Audit current site analytics", "Discovery", "done", "med", 1, 3, "List the top pages and the pages with high exit rates."],
  ["Draft sitemap and page list", "Design", "review", "med", 4, 6, ""],
  ["Wireframe home and pricing pages", "Design", "doing", "high", 7, 9, "Start with the phone layout."],
  ["Pick type and color system", "Design", "todo", "low", 14, 5, ""],
  ["Set up CMS and staging site", "Build", "todo", "high", 16, 8, ""],
  ["Write page copy", "Build", "backlog", "med", 21, 12, ""],
  ["Build page templates", "Build", "backlog", "high", 28, 12, ""],
  ["QA on phone and desktop", "Launch", "backlog", "med", 37, 7, "Test forms, links and page speed."],
  ["Go live and redirect old URLs", "Launch", "backlog", "high", 44, 2, ""]
];

projectRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const name = text(body.name, "Project name", { max: 80, required: true });
  const description = text(body.description, "Description", { max: 500 });
  const color = body.color === undefined ? "indigo" : oneOf(body.color, "Color", PROJECT_COLORS);
  const template = body.template === undefined ? "blank" : oneOf(body.template, "Template", ["blank", "example"] as const);
  const visibility = body.visibility === undefined ? "company" : oneOf(body.visibility, "Visibility", VISIBILITIES);
  const companyId = typeof body.companyId === "string" ? body.companyId : await currentCompanyId(c.env, user.id);
  if (!companyId) throw new HttpError(400, "Create a company first. Every project belongs to a company.");
  await requirePermission(c.env, companyId, user.id, "projects.create");
  // New projects start with the company's AI defaults.
  const co = await c.env.DB.prepare("SELECT ai_defaults FROM companies WHERE id = ?").bind(companyId).first<{ ai_defaults: string }>();
  const aiPolicy = JSON.stringify(parsePolicy(co?.ai_defaults));
  const id = newId();
  const iso = nowIso();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "INSERT INTO projects (id, name, description, color, company_id, visibility, ai_policy, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, name, description, color, companyId, visibility, aiPolicy, user.id, iso, iso),
    c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, iso)
  ];
  const cols = defaultColumnStatements(c.env, id);
  stmts.push(...cols.stmts);
  if (template === "example") {
    // Start on the Monday of this week so the plan lines up with the calendar.
    const today = todayIso();
    const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
    const start = addDays(today, -dow);
    const orders: Record<string, number> = {};
    for (const [title, phase, status, priority, off, len, notes] of EXAMPLE_TASKS) {
      orders[status] = (orders[status] ?? 0) + 1000;
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO tasks (id, project_id, column_id, title, notes, status, priority, phase, start_date, end_date, sort_order, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(newId(), id, cols.ids[status as keyof typeof cols.ids], title, notes, status, priority, phase, addDays(start, off), addDays(start, off + len - 1), orders[status], user.id, user.id, iso, iso)
      );
    }
  }
  await c.env.DB.batch(stmts);
  return c.json({ id }, 201);
});

export async function loadProject(env: Env, projectId: string, role: Role): Promise<ProjectDetail> {
  const [p, members, invitations, tasks, attachments, columns, requests] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, description, color, company_id, visibility, rev, ai_policy, created_at, updated_at FROM projects WHERE id = ?").bind(projectId),
    env.DB.prepare(
      "SELECT u.id AS user_id, u.email, u.name, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name COLLATE NOCASE"
    ).bind(projectId),
    env.DB.prepare("SELECT id, email, role, created_at FROM invitations WHERE project_id = ? ORDER BY created_at").bind(projectId),
    env.DB.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY status, sort_order").bind(projectId),
    env.DB.prepare("SELECT * FROM attachments WHERE project_id = ? ORDER BY created_at").bind(projectId),
    env.DB.prepare("SELECT id, project_id, name, category, position FROM board_columns WHERE project_id = ? ORDER BY position").bind(projectId),
    env.DB.prepare(
      "SELECT r.id, r.user_id, r.note, r.created_at, u.name, u.email FROM access_requests r JOIN users u ON u.id = r.user_id WHERE r.project_id = ? AND r.status = 'pending' ORDER BY r.created_at"
    ).bind(projectId)
  ]);
  const pr = p.results[0] as
    | { id: string; name: string; description: string; color: ProjectColor; company_id: string | null; visibility: Visibility; rev: number; ai_policy: string; created_at: string; updated_at: string }
    | undefined;
  if (!pr) throw new HttpError(404, "This project does not exist.");
  const aiPolicy = parsePolicy(pr.ai_policy);
  return {
    project: { id: pr.id, name: pr.name, description: pr.description, color: pr.color, companyId: pr.company_id, visibility: pr.visibility, rev: pr.rev, createdAt: pr.created_at, updatedAt: pr.updated_at },
    role,
    columns: (columns.results as unknown as Parameters<typeof toColumn>[0][]).map(toColumn),
    aiPolicy,
    agentLevel: effectiveLevel(role, aiPolicy),
    members: (members.results as Array<{ user_id: string; email: string; name: string; role: Role }>).map(
      (m): Member => ({ userId: m.user_id, email: m.email, name: m.name, role: m.role })
    ),
    // Only owners manage invitations, so only owners see them.
    invitations:
      role === "owner"
        ? (invitations.results as Array<{ id: string; email: string; role: Role; created_at: string }>).map(
            (i): Invitation => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at })
          )
        : [],
    accessRequests:
      role === "owner"
        ? (requests.results as Array<{ id: string; user_id: string; note: string; created_at: string; name: string; email: string }>).map(
            (r): AccessRequest => ({ id: r.id, userId: r.user_id, name: r.name, email: r.email, note: r.note, createdAt: r.created_at })
          )
        : [],
    tasks: (tasks.results as unknown as TaskRow[]).map(toTask),
    attachments: (attachments.results as unknown as AttachmentRow[]).map(toAttachment)
  };
}

projectRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireRole(c.env, id, user.id, "viewer");
  return c.json(await loadProject(c.env, id, role));
});

/** Cheap check the web app polls every few seconds. */
projectRoutes.get("/:id/rev", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "viewer");
  const row = await c.env.DB.prepare("SELECT rev FROM projects WHERE id = ?").bind(id).first<{ rev: number }>();
  return c.json({ rev: row?.rev ?? 0 });
});

projectRoutes.patch("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const body = await readJson(c);
  // Visibility decides who can see the project, so only owners change it.
  await requireRole(c.env, id, user.id, body.visibility !== undefined ? "owner" : "editor");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.visibility !== undefined) {
    sets.push("visibility = ?");
    vals.push(oneOf(body.visibility, "Visibility", VISIBILITIES));
  }
  if (body.name !== undefined) {
    sets.push("name = ?");
    vals.push(text(body.name, "Project name", { max: 80, required: true }));
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    vals.push(text(body.description, "Description", { max: 500 }));
  }
  if (body.color !== undefined) {
    sets.push("color = ?");
    vals.push(oneOf(body.color, "Color", PROJECT_COLORS));
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change.");
  const res = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    bumpRev(c.env, id)
  ]);
  return c.json({ rev: revFrom(res) });
});

projectRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "owner");
  await deletePrefix(c.env.FILES, `projects/${id}/`);
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

/* Members and invitations */

projectRoutes.post("/:id/members", async (c) => {
  const r = await inviteMember(c.env, requireUser(c), c.req.param("id"), await readJson(c), appUrl(c), (p) => c.executionCtx.waitUntil(p));
  return c.json({ added: r.added, rev: r.rev }, 201);
});

projectRoutes.patch("/:id/members/:userId", async (c) => {
  const r = await changeMemberRole(c.env, requireUser(c), c.req.param("id"), c.req.param("userId"), (await readJson(c)).role);
  return c.json({ rev: r.rev });
});

projectRoutes.delete("/:id/members/:userId", async (c) => c.json(await removeMember(c.env, requireUser(c), c.req.param("id"), c.req.param("userId"))));

projectRoutes.delete("/:id/invitations/:invId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "owner");
  const res = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM invitations WHERE id = ? AND project_id = ?").bind(c.req.param("invId"), id),
    bumpRev(c.env, id)
  ]);
  return c.json({ rev: revFrom(res) });
});

/* AI agent policy and activity */

projectRoutes.patch("/:id/ai-policy", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "owner");
  const body = await readJson(c);
  const row = await c.env.DB.prepare("SELECT ai_policy FROM projects WHERE id = ?").bind(id).first<{ ai_policy: string }>();
  const policy: AiPolicy = parsePolicy(row?.ai_policy);
  for (const role of ROLES) {
    if (body[role] === undefined) continue;
    const level = oneOf(body[role], `Level for ${role}`, AGENT_LEVELS) as AgentLevel;
    if (levelRank(level) > levelRank(ROLE_CEILING[role])) {
      throw new HttpError(400, `The ${role} role allows the agent up to "${ROLE_CEILING[role]}". Choose that level or a lower one.`);
    }
    policy[role] = level;
  }
  if (body.scope !== undefined) policy.scope = oneOf(body.scope, "Topic scope", AGENT_SCOPES);
  if (body.readNotes !== undefined) {
    if (typeof body.readNotes !== "boolean") throw new HttpError(400, "Note search must be true or false.");
    policy.readNotes = body.readNotes;
  }
  const before = parsePolicy(row?.ai_policy);
  const stmts = [c.env.DB.prepare("UPDATE projects SET ai_policy = ? WHERE id = ?").bind(JSON.stringify(policy), id)];
  // Notes are embedded for search only when note search is on, so a change re-indexes the project.
  if (before.readNotes !== policy.readNotes) stmts.push(reindexProjectStatement(c.env, id));
  const res = await c.env.DB.batch([...stmts, bumpRev(c.env, id)]);
  return c.json({ aiPolicy: policy, rev: revFrom(res) });
});

/** The agent action log. Every member can read it, so agent work is always visible. */
projectRoutes.get("/:id/agent-actions", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "viewer");
  const rows = await c.env.DB.prepare(
    "SELECT id, user_id, tool, summary, status, result, created_at, decided_at FROM agent_actions WHERE project_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(id)
    .all<{ id: string; user_id: string | null; tool: string; summary: string; status: AgentAction["status"]; result: string | null; created_at: string; decided_at: string | null }>();
  const actions: AgentAction[] = rows.results.map((r) => ({
    id: r.id,
    userId: r.user_id,
    tool: r.tool,
    summary: r.summary,
    status: r.status,
    result: r.result,
    createdAt: r.created_at,
    decidedAt: r.decided_at
  }));
  return c.json({ actions });
});

/* Access requests */

/** What the "request access" page needs. It never reveals the project name. */
projectRoutes.get("/:id/access", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const access = await projectAccess(c.env, id, user.id);
  if (!access) throw new HttpError(404, "This project does not exist.");
  if (access.role) return c.json({ hasAccess: true, requested: false });
  const pending = await c.env.DB.prepare("SELECT 1 AS ok FROM access_requests WHERE project_id = ? AND user_id = ? AND status = 'pending'").bind(id, user.id).first();
  return c.json({ hasAccess: false, requested: !!pending });
});

projectRoutes.post("/:id/access-requests", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const access = await projectAccess(c.env, id, user.id);
  if (!access) throw new HttpError(404, "This project does not exist.");
  if (access.role) throw new HttpError(409, "You already have access to this project.");
  const note = text((await readJson(c)).note, "Note", { max: 300 });
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE user_id = ? AND created_at > ?")
    .bind(user.id, new Date(Date.now() - 3600000).toISOString())
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) throw new HttpError(429, "You sent many access requests in the last hour. Wait, then try again.");
  try {
    await c.env.DB.prepare("INSERT INTO access_requests (id, project_id, user_id, note, created_at) VALUES (?, ?, ?, ?, ?)").bind(newId(), id, user.id, note, nowIso()).run();
  } catch {
    throw new HttpError(409, "You already asked for access. An owner will see your request.");
  }
  // Tell the project owners.
  const project = await c.env.DB.prepare("SELECT name FROM projects WHERE id = ?").bind(id).first<{ name: string }>();
  const owners = await c.env.DB.prepare("SELECT u.email FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? AND m.role = 'owner'").bind(id).all<{ email: string }>();
  const url = `${appUrl(c)}/p/${id}/members`;
  for (const o of owners.results) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, accessRequestEmail(c.env, { to: o.email, projectName: project!.name, requesterName: user.name || user.email, requesterEmail: user.email, note, url })).catch((e) =>
        console.error("[openact] access request email failed", e)
      )
    );
  }
  await c.env.DB.prepare("UPDATE projects SET rev = rev + 1 WHERE id = ?").bind(id).run();
  markProjectChanged(id);
  return c.json({ requested: true }, 201);
});

projectRoutes.post("/:id/access-requests/:reqId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "owner");
  const body = await readJson(c);
  if (typeof body.approve !== "boolean") throw new HttpError(400, "Choose to approve or decline the request.");
  const req = await c.env.DB.prepare("SELECT id, user_id FROM access_requests WHERE id = ? AND project_id = ? AND status = 'pending'")
    .bind(c.req.param("reqId"), id)
    .first<{ id: string; user_id: string }>();
  if (!req) throw new HttpError(404, "This request was already answered or no longer exists.");
  const iso = nowIso();
  if (!body.approve) {
    const res = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE access_requests SET status = 'declined', decided_by = ?, decided_at = ? WHERE id = ?").bind(user.id, iso, req.id),
      bumpRev(c.env, id)
    ]);
    return c.json({ rev: revFrom(res) });
  }
  const role = body.role === undefined ? "viewer" : oneOf(body.role, "Role", ROLES);
  const res = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE access_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?").bind(user.id, iso, req.id),
    c.env.DB.prepare(
      "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role"
    ).bind(id, req.user_id, role, iso),
    // Someone from outside the company joins it as a guest, so they see only this project.
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO company_members (company_id, user_id, role, created_at) SELECT company_id, ?, 'guest', ? FROM projects WHERE id = ? AND company_id IS NOT NULL"
    ).bind(req.user_id, iso, id),
    bumpRev(c.env, id)
  ]);
  const info = await c.env.DB.prepare("SELECT u.email, p.name FROM users u, projects p WHERE u.id = ? AND p.id = ?").bind(req.user_id, id).first<{ email: string; name: string }>();
  if (info) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, accessGrantedEmail(c.env, { to: info.email, projectName: info.name, role: role === "owner" ? "Owner" : role === "editor" ? "Editor" : "Viewer", url: `${appUrl(c)}/p/${id}` })).catch((e) =>
        console.error("[openact] access granted email failed", e)
      )
    );
  }
  return c.json({ rev: revFrom(res) });
});
