import { Hono } from "hono";
import { acceptLive, assertLiveRequest, disconnectFromRoom, flushChanges, requireUser, type AppEnv, type Env } from "@openact/core/server";
import { PROJECT_ROOM, markProjectChanged, requireRole } from "./data";

/*
 * Live updates for projects. The core holds the WebSockets in one room per project ("project:<id>").
 * This file checks access, and tells the core how to read a project's revision number.
 */

export { markProjectChanged };

/** Reads the current revision of each project. The core calls it before it notifies the rooms. */
export async function projectRevisions(env: Env, ids: string[]): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(`SELECT id, rev FROM projects WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: string; rev: number }>();
  return new Map(rows.results.map((r) => [r.id, r.rev]));
}

/** Notifies the rooms of the projects that changed so far. The agent calls it during a streamed response. */
export const flushProjectChanges = (env: Env) => flushChanges(env);

/** Closes a person's live connections to a project, for example after they are removed. */
export const disconnectFromProject = (env: Env, projectId: string, userId: string) => disconnectFromRoom(env, PROJECT_ROOM, projectId, userId);

export const liveRoutes = new Hono<AppEnv>();

/** GET /api/projects/:id/live with Upgrade: websocket */
liveRoutes.get("/:id/live", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  assertLiveRequest(c);
  await requireRole(c.env, id, user.id, "viewer");
  const row = await c.env.DB.prepare("SELECT rev FROM projects WHERE id = ?").bind(id).first<{ rev: number }>();
  return acceptLive(c, PROJECT_ROOM, id, { userId: user.id, name: user.name || user.email.split("@")[0]! }, row?.rev ?? 0);
});
