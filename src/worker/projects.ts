import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import {
  PROJECT_COLORS,
  ROLES,
  ROLE_LABELS,
  type Invitation,
  type Member,
  type ProjectColor,
  type ProjectDetail,
  type ProjectSummary,
  type Role
} from "../shared/types";
import { bumpRev, deletePrefix, requireRole, revFrom, toAttachment, toTask, type AttachmentRow, type TaskRow } from "./data";
import { inviteEmail, sendEmail } from "./email";
import { HttpError, addDays, appUrl, isEmail, newId, normalizeEmail, nowIso, oneOf, readJson, requireUser, text, todayIso } from "./util";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.description, p.color, p.updated_at, m.role,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.end_date < ?) AS late_count,
       (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
     FROM projects p
     JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
     ORDER BY p.updated_at DESC`
  )
    .bind(todayIso(), user.id)
    .all<{
      id: string;
      name: string;
      description: string;
      color: ProjectColor;
      updated_at: string;
      role: Role;
      task_count: number;
      done_count: number;
      late_count: number;
      member_count: number;
    }>();
  const projects: ProjectSummary[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    role: r.role,
    taskCount: r.task_count,
    doneCount: r.done_count,
    lateCount: r.late_count,
    memberCount: r.member_count,
    updatedAt: r.updated_at
  }));
  return c.json({ projects });
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
  const id = newId();
  const iso = nowIso();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO projects (id, name, description, color, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      name,
      description,
      color,
      user.id,
      iso,
      iso
    ),
    c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, iso)
  ];
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
          `INSERT INTO tasks (id, project_id, title, notes, status, priority, phase, start_date, end_date, sort_order, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(newId(), id, title, notes, status, priority, phase, addDays(start, off), addDays(start, off + len - 1), orders[status], user.id, user.id, iso, iso)
      );
    }
  }
  await c.env.DB.batch(stmts);
  return c.json({ id }, 201);
});

export async function loadProject(env: Env, projectId: string, role: Role): Promise<ProjectDetail> {
  const [p, members, invitations, tasks, attachments] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, description, color, rev, created_at, updated_at FROM projects WHERE id = ?").bind(projectId),
    env.DB.prepare(
      "SELECT u.id AS user_id, u.email, u.name, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name COLLATE NOCASE"
    ).bind(projectId),
    env.DB.prepare("SELECT id, email, role, created_at FROM invitations WHERE project_id = ? ORDER BY created_at").bind(projectId),
    env.DB.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY status, sort_order").bind(projectId),
    env.DB.prepare("SELECT * FROM attachments WHERE project_id = ? ORDER BY created_at").bind(projectId)
  ]);
  const pr = p.results[0] as
    | { id: string; name: string; description: string; color: ProjectColor; rev: number; created_at: string; updated_at: string }
    | undefined;
  if (!pr) throw new HttpError(404, "This project does not exist.");
  return {
    project: { id: pr.id, name: pr.name, description: pr.description, color: pr.color, rev: pr.rev, createdAt: pr.created_at, updatedAt: pr.updated_at },
    role,
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
  await requireRole(c.env, id, user.id, "editor");
  const body = await readJson(c);
  const sets: string[] = [];
  const vals: unknown[] = [];
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

async function ownerCount(env: Env, projectId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner'").bind(projectId).first<{ n: number }>();
  return row?.n ?? 0;
}

projectRoutes.post("/:id/members", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "owner");
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) throw new HttpError(400, "Type a valid email address.");
  const role = body.role === undefined ? "editor" : oneOf(body.role, "Role", ROLES);
  const project = await c.env.DB.prepare("SELECT name FROM projects WHERE id = ?").bind(id).first<{ name: string }>();
  const iso = nowIso();
  const url = `${appUrl(c)}/p/${id}`;
  const existing = await c.env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email).first<{ id: string; name: string }>();

  if (existing) {
    const already = await c.env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?").bind(id, existing.id).first();
    if (already) throw new HttpError(409, "This person is already a member of the project.");
    const res = await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").bind(id, existing.id, role, iso),
      bumpRev(c.env, id)
    ]);
    const mail = inviteEmail(c.env, { to: email, projectName: project!.name, inviterName: user.name, role: ROLE_LABELS[role], url, hasAccount: true });
    c.executionCtx.waitUntil(sendEmail(c.env, mail).catch((e) => console.error("[openact] invite email failed", e)));
    return c.json({ added: "member", rev: revFrom(res) }, 201);
  }

  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO invitations (id, project_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, created_at = excluded.created_at`
    ).bind(newId(), id, email, role, user.id, iso),
    bumpRev(c.env, id)
  ]);
  await sendEmail(c.env, inviteEmail(c.env, { to: email, projectName: project!.name, inviterName: user.name, role: ROLE_LABELS[role], url, hasAccount: false }));
  return c.json({ added: "invitation", rev: revFrom(res) }, 201);
});

projectRoutes.patch("/:id/members/:userId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const target = c.req.param("userId");
  await requireRole(c.env, id, user.id, "owner");
  const role = oneOf((await readJson(c)).role, "Role", ROLES);
  const current = await c.env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?").bind(id, target).first<{ role: Role }>();
  if (!current) throw new HttpError(404, "This person is not a member of the project.");
  if (current.role === "owner" && role !== "owner" && (await ownerCount(c.env, id)) <= 1) {
    throw new HttpError(400, "A project needs at least one owner. Make someone else an owner first.");
  }
  const res = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?").bind(role, id, target),
    bumpRev(c.env, id)
  ]);
  return c.json({ rev: revFrom(res) });
});

projectRoutes.delete("/:id/members/:userId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const target = c.req.param("userId");
  // Owners can remove anyone. Everyone can leave.
  await requireRole(c.env, id, user.id, target === user.id ? "viewer" : "owner");
  const current = await c.env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?").bind(id, target).first<{ role: Role }>();
  if (!current) throw new HttpError(404, "This person is not a member of the project.");
  if (current.role === "owner" && (await ownerCount(c.env, id)) <= 1) {
    throw new HttpError(400, "A project needs at least one owner. Make someone else an owner first, or delete the project.");
  }
  const res = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").bind(id, target),
    c.env.DB.prepare("UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?").bind(id, target),
    bumpRev(c.env, id)
  ]);
  return c.json({ rev: revFrom(res) });
});

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
