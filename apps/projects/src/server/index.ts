import type { MiddlewareHandler } from "hono";
import { DAILY_CRON, HttpError, defineServerApp, deletePrefix, nowIso, oneOf, registerRoomKind, type AppEnv, type Env } from "@openact/core/server";
import { AGENT_LEVELS, AGENT_SCOPES, ROLES, type AgentLevel, type AiPolicy, type User } from "../shared/types";
import { ROLE_CEILING, levelRank, parsePolicy } from "../shared/agent-policy";
import { projectRoutes } from "./projects";
import { attachmentRoutes, columnRoutes, projectTaskRoutes, taskRoutes } from "./tasks";
import { aiRoutes } from "./ai";
import { aguiRoutes } from "./agui";
import { processVectorOutbox, searchRoutes, vectorsEnabled } from "./search";
import { PROJECT_ROOM, markProjectChanged } from "./data";
import { disconnectFromProject, liveRoutes, projectRevisions } from "./live";

/*
 * The projects app: projects, tasks, the board, timeline and calendar, the AI agent and task search.
 * It keeps the API paths that OpenAct had before apps, so existing clients keep working.
 */

registerRoomKind(PROJECT_ROOM, projectRevisions);

/** After a change, index the changed tasks for search in the background. */
const indexAfterWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.req.method !== "GET" && vectorsEnabled(c.env)) {
    c.executionCtx.waitUntil(processVectorOutbox(c.env, 32).catch((e) => console.warn("[openact] search indexing failed", e)));
  }
};

function readAiDefaults(body: Record<string, unknown>, current: AiPolicy): AiPolicy {
  const policy = { ...current };
  for (const role of ROLES) {
    if (body[role] === undefined) continue;
    const level = oneOf(body[role], `Level for ${role}`, AGENT_LEVELS) as AgentLevel;
    if (levelRank(level) > levelRank(ROLE_CEILING[role]))
      throw new HttpError(400, `The ${role} role allows the agent up to "${ROLE_CEILING[role]}". Choose that level or a lower one.`);
    policy[role] = level;
  }
  if (body.scope !== undefined) policy.scope = oneOf(body.scope, "Topic scope", AGENT_SCOPES);
  if (body.readNotes !== undefined) {
    if (typeof body.readNotes !== "boolean") throw new HttpError(400, "Note search must be true or false.");
    policy.readNotes = body.readNotes;
  }
  return policy;
}

/** Turns pending project invitations for this person into memberships. */
async function acceptInvitations(env: Env, user: User): Promise<void> {
  const invites = await env.DB.prepare("SELECT id, project_id, role FROM invitations WHERE email = ?")
    .bind(user.email)
    .all<{ id: string; project_id: string; role: string }>();
  if (!invites.results.length) return;
  const iso = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const inv of invites.results) {
    markProjectChanged(inv.project_id);
    stmts.push(
      env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").bind(
        inv.project_id,
        user.id,
        inv.role,
        iso
      ),
      // A project invitation makes the person a company guest, so they see only this project.
      env.DB.prepare(
        "INSERT OR IGNORE INTO company_members (company_id, user_id, role, created_at) SELECT company_id, ?, 'guest', ? FROM projects WHERE id = ? AND company_id IS NOT NULL"
      ).bind(user.id, iso, inv.project_id),
      env.DB.prepare("DELETE FROM invitations WHERE id = ?").bind(inv.id),
      env.DB.prepare("UPDATE projects SET rev = rev + 1, updated_at = ? WHERE id = ?").bind(iso, inv.project_id)
    );
  }
  await env.DB.batch(stmts);
}

export default defineServerApp({
  id: "projects",
  name: "Projects",
  routes: (api) => {
    api.route("/api/projects", liveRoutes);
    api.route("/api/projects", projectRoutes);
    api.route("/api/projects", projectTaskRoutes);
    api.route("/api/projects", aiRoutes);
    api.route("/api/projects", aguiRoutes);
    api.route("/api/tasks", taskRoutes);
    api.route("/api/columns", columnRoutes);
    api.route("/api/attachments", attachmentRoutes);
    api.route("/api/search", searchRoutes);
  },
  middleware: [indexAfterWrites],
  scheduled: async (env, cron) => {
    if (cron === DAILY_CRON) {
      // Approval requests that nobody answered.
      const now = Date.now();
      await env.DB.prepare("UPDATE agent_actions SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at < ?")
        .bind(new Date(now).toISOString(), new Date(now - 30 * 60000).toISOString())
        .run();
    }
    // Catch up on search indexing that did not finish after a request.
    for (let i = 0; i < 6; i++) {
      const r = await processVectorOutbox(env, 64);
      if (!r.indexed && !r.deleted) break;
    }
  },
  hooks: {
    allowSignup: async (env, email) => !!(await env.DB.prepare("SELECT id FROM invitations WHERE email = ? LIMIT 1").bind(email).first()),
    signedIn: acceptInvitations,
    companyMemberRemoved: async (env, companyId, userId) => {
      const iso = nowIso();
      const projects = await env.DB.prepare("SELECT id FROM projects WHERE company_id = ?").bind(companyId).all<{ id: string }>();
      await env.DB.batch([
        env.DB.prepare("UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(
          userId,
          companyId
        ),
        env.DB.prepare("DELETE FROM project_members WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(
          userId,
          companyId
        ),
        env.DB.prepare("DELETE FROM access_requests WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(
          userId,
          companyId
        ),
        env.DB.prepare("DELETE FROM projects_pins WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(userId, companyId),
        env.DB.prepare("DELETE FROM projects_recent_tasks WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(
          userId,
          companyId
        ),
        env.DB.prepare("UPDATE projects SET rev = rev + 1, updated_at = ? WHERE company_id = ?").bind(iso, companyId)
      ]);
      for (const p of projects.results) markProjectChanged(p.id);
      await Promise.all(projects.results.map((p) => disconnectFromProject(env, p.id, userId)));
    },
    companyDeleting: async (env, companyId) => {
      const projects = await env.DB.prepare("SELECT id FROM projects WHERE company_id = ?").bind(companyId).all<{ id: string }>();
      for (const p of projects.results) await deletePrefix(env.FILES, `projects/${p.id}/`);
      await env.DB.prepare("DELETE FROM projects WHERE company_id = ?").bind(companyId).run();
    },
    companyDetail: async (env, companyId) => {
      const row = await env.DB.prepare("SELECT ai_defaults FROM companies WHERE id = ?").bind(companyId).first<{ ai_defaults: string }>();
      return { aiDefaults: parsePolicy(row?.ai_defaults) };
    },
    companyUpdate: async (env, companyId, body) => {
      if (body.aiDefaults === undefined) return false;
      if (!body.aiDefaults || typeof body.aiDefaults !== "object") throw new HttpError(400, "AI defaults must be an object.");
      const row = await env.DB.prepare("SELECT ai_defaults FROM companies WHERE id = ?").bind(companyId).first<{ ai_defaults: string }>();
      const next = readAiDefaults(body.aiDefaults as Record<string, unknown>, parsePolicy(row?.ai_defaults));
      await env.DB.prepare("UPDATE companies SET ai_defaults = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(next), nowIso(), companyId).run();
      return true;
    }
  }
});
