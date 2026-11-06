import { DurableObject } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import { requireRole } from "./data";
import { HttpError, requireUser } from "./util";

/*
 * Live updates. One Durable Object per project holds the open WebSockets for that project.
 *
 * - The Worker checks the session, the Origin and the project role before it forwards the upgrade.
 * - The object uses the WebSocket Hibernation API, so an idle connection costs no duration.
 * - Messages carry only the project's revision number and who is viewing. Never project data:
 *   each page loads the data through the normal API, with the normal access checks.
 * - When live updates are not available, the web app polls the revision every 5 seconds, as before.
 */

export interface Viewer {
  userId: string;
  name: string;
}

export type LiveMessage = { type: "rev"; rev: number } | { type: "presence"; viewers: Viewer[] };

export class ProjectRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings get an answer without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Accepts a WebSocket. Only the Worker calls this, after its access checks. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    const viewer: Viewer = {
      userId: request.headers.get("x-openact-user") ?? "",
      name: decodeURIComponent(request.headers.get("x-openact-name") ?? "").slice(0, 80)
    };
    const rev = Number(request.headers.get("x-openact-rev") ?? 0);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [viewer.userId]);
    server.serializeAttachment(viewer);
    server.send(JSON.stringify({ type: "rev", rev } satisfies LiveMessage));
    this.sendPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Tells every open page that the project changed. */
  async notify(rev: number): Promise<void> {
    this.broadcast({ type: "rev", rev });
  }

  /** Closes the connections of someone who lost access. */
  async disconnect(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) ws.close(4403, "Access removed");
    this.sendPresence();
  }

  webSocketMessage(): void {
    // Pages send nothing but pings, which the auto-response answers.
  }

  webSocketClose(ws: WebSocket): void {
    this.sendPresence(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.sendPresence(ws);
  }

  private open(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
  }

  private broadcast(msg: LiveMessage, except?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.open(except)) {
      try {
        ws.send(data);
      } catch {
        /* The socket closed while we sent. Its close handler updates presence. */
      }
    }
  }

  private sendPresence(closing?: WebSocket): void {
    const seen = new Map<string, Viewer>();
    for (const ws of this.open(closing)) {
      const v = ws.deserializeAttachment() as Viewer | null;
      if (v?.userId) seen.set(v.userId, v);
    }
    this.broadcast({ type: "presence", viewers: [...seen.values()] }, closing);
  }
}

/* Change tracking for the current request */

const changes = new AsyncLocalStorage<Set<string>>();

/** Records that a project changed in this request. bumpRev calls it. */
export function markProjectChanged(projectId: string): void {
  changes.getStore()?.add(projectId);
}

/** Notifies the rooms of the projects that changed so far, then forgets them. */
export async function flushProjectChanges(env: Env): Promise<void> {
  const set = changes.getStore();
  if (!set?.size || !env.PROJECT_ROOMS) return;
  const ids = [...set];
  set.clear();
  const rows = await env.DB.prepare(`SELECT id, rev FROM projects WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: string; rev: number }>();
  await Promise.all(
    rows.results.map((r) =>
      env.PROJECT_ROOMS!.get(env.PROJECT_ROOMS!.idFromName(r.id))
        .notify(r.rev)
        .catch((e: unknown) => console.warn("[openact] live update failed", e))
    )
  );
}

/** Closes a person's live connections to a project, for example after they are removed. */
export async function disconnectFromProject(env: Env, projectId: string, userId: string): Promise<void> {
  if (!env.PROJECT_ROOMS) return;
  await env.PROJECT_ROOMS.get(env.PROJECT_ROOMS.idFromName(projectId))
    .disconnect(userId)
    .catch(() => {});
}

/** Collects the projects that a request changes, and notifies their rooms after the response. */
export const liveChanges: MiddlewareHandler<AppEnv> = async (c, next) => {
  const set = new Set<string>();
  await changes.run(set, next);
  if (set.size) c.executionCtx.waitUntil(changes.run(set, () => flushProjectChanges(c.env)));
};

/* The WebSocket route */

export const liveRoutes = new Hono<AppEnv>();

/** GET /api/projects/:id/live with Upgrade: websocket */
liveRoutes.get("/:id/live", async (c) => {
  const user = requireUser(c);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "Open this address with a WebSocket.");
  // Browsers send cookies with WebSocket requests from any site, so check where the request comes from.
  const origin = c.req.header("origin");
  if (!origin || origin !== new URL(c.req.url).origin) throw new HttpError(403, "Cross-site WebSocket requests are not allowed.");
  if (!c.env.PROJECT_ROOMS) throw new HttpError(501, "Live updates are not set up. The app checks for changes every few seconds instead.");
  const id = c.req.param("id");
  await requireRole(c.env, id, user.id, "viewer");
  const row = await c.env.DB.prepare("SELECT rev FROM projects WHERE id = ?").bind(id).first<{ rev: number }>();
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-openact-user", user.id);
  headers.set("x-openact-name", encodeURIComponent(user.name || user.email.split("@")[0]!));
  headers.set("x-openact-rev", String(row?.rev ?? 0));
  const stub = c.env.PROJECT_ROOMS.get(c.env.PROJECT_ROOMS.idFromName(id));
  return stub.fetch(new Request(c.req.raw.url, { method: "GET", headers }));
});
