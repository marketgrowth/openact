import { DurableObject } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import { HttpError } from "./util";

/*
 * Live updates. One Durable Object per room holds the open WebSockets for that room.
 * A room is any shared thing that pages watch, such as a project. Its key is "<kind>:<id>".
 * The class keeps the name ProjectRoom because deployed Workers already use it.
 *
 * - The app checks the session and the person's access. acceptLive() checks the Origin, then forwards the upgrade.
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

/* Room kinds: how to read the current revision of a room */

type RevisionReader = (env: Env, ids: string[]) => Promise<Map<string, number>>;
const kinds = new Map<string, RevisionReader>();

/** An app registers each kind of room it uses, with a function that reads current revision numbers. */
export function registerRoomKind(kind: string, revisions: RevisionReader): void {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) throw new Error(`Room kind "${kind}" must be lowercase letters, numbers and dashes.`);
  kinds.set(kind, revisions);
}

const roomKey = (kind: string, id: string) => `${kind}:${id}`;

/* Change tracking for the current request */

const changes = new AsyncLocalStorage<Set<string>>();

/** Records that a room changed in this request. Its open pages reload after the response. */
export function markChanged(kind: string, id: string): void {
  changes.getStore()?.add(roomKey(kind, id));
}

/** Notifies the rooms that changed so far, then forgets them. Call it after a streamed response changes data. */
export async function flushChanges(env: Env): Promise<void> {
  const set = changes.getStore();
  if (!set?.size || !env.PROJECT_ROOMS) return;
  const keys = [...set];
  set.clear();
  const byKind = new Map<string, string[]>();
  for (const k of keys) {
    const i = k.indexOf(":");
    const kind = k.slice(0, i);
    byKind.set(kind, [...(byKind.get(kind) ?? []), k.slice(i + 1)]);
  }
  const rooms = env.PROJECT_ROOMS;
  await Promise.all(
    [...byKind].map(async ([kind, ids]) => {
      const read = kinds.get(kind);
      if (!read) return console.warn(`[openact] no room kind "${kind}" is registered`);
      const revs = await read(env, ids);
      await Promise.all(
        [...revs].map(([id, rev]) =>
          rooms
            .get(rooms.idFromName(roomKey(kind, id)))
            .notify(rev)
            .catch((e: unknown) => console.warn("[openact] live update failed", e))
        )
      );
    })
  );
}

/** Closes a person's live connections to a room, for example after they lose access. */
export async function disconnectFromRoom(env: Env, kind: string, id: string, userId: string): Promise<void> {
  if (!env.PROJECT_ROOMS) return;
  await env.PROJECT_ROOMS.get(env.PROJECT_ROOMS.idFromName(roomKey(kind, id)))
    .disconnect(userId)
    .catch(() => {});
}

/** Collects the rooms that a request changes, and notifies them after the response. */
export const liveChanges: MiddlewareHandler<AppEnv> = async (c, next) => {
  const set = new Set<string>();
  await changes.run(set, next);
  if (set.size) c.executionCtx.waitUntil(changes.run(set, () => flushChanges(c.env)));
};

/**
 * Checks that a request can open a live connection: a WebSocket upgrade from this site, with live updates set up.
 * Browsers send cookies with WebSocket requests from any site, so the Origin check matters.
 * Call it before the access check, so another site learns nothing about the room.
 */
export function assertLiveRequest(c: Context<AppEnv>): void {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "Open this address with a WebSocket.");
  const origin = c.req.header("origin");
  if (!origin || origin !== new URL(c.req.url).origin) throw new HttpError(403, "Cross-site WebSocket requests are not allowed.");
  if (!c.env.PROJECT_ROOMS) throw new HttpError(501, "Live updates are not set up. The app checks for changes every few seconds instead.");
}

/** Opens a WebSocket to a room. The app's route calls assertLiveRequest() and checks access first. */
export async function acceptLive(c: Context<AppEnv>, kind: string, id: string, viewer: Viewer, rev: number): Promise<Response> {
  assertLiveRequest(c);
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-openact-user", viewer.userId);
  headers.set("x-openact-name", encodeURIComponent(viewer.name));
  headers.set("x-openact-rev", String(rev));
  const stub = c.env.PROJECT_ROOMS!.get(c.env.PROJECT_ROOMS!.idFromName(roomKey(kind, id)));
  return stub.fetch(new Request(c.req.raw.url, { method: "GET", headers }));
}
