import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import type { Env } from "@openact/core/server";
import { EMPTY_DOC, sanitizeDoc } from "../shared/content";
import { CONTENT_MAX_BYTES } from "../shared/types";
import { MSG_AWARENESS, MSG_SYNC, fromChunks, messageKind, toChunks } from "../shared/collab";
import { docSchema } from "../shared/schema";

/*
 * Live editing: one Durable Object per doc holds the shared Yjs doc and the open editors.
 *
 * - The Worker checks the session, the Docs permissions and the Origin, then forwards the WebSocket here.
 *   It says in headers who the person is and whether they can edit. The room drops changes from people who can only read.
 * - Messages follow the y-websocket protocol: sync (step 1, step 2, updates) and awareness (cursors and names).
 * - The room saves each change in its own storage at once, so nothing is lost if it stops. A few seconds later it
 *   folds the changes into one saved copy, in parts. When the room is new, it starts from the doc's JSON in D1.
 * - A few seconds after changes stop, it writes a cleaned JSON copy to D1. The library, share links, print and search read that copy.
 * - It uses the WebSocket Hibernation API. After a rest, it loads the shared doc again from storage.
 */

export type DocsEnv = Env & { DOCS_ROOMS?: DurableObjectNamespace<DocsRoom> };

const FIELD = "default"; // The Yjs field that @tiptap/extension-collaboration uses.
const SAVE_AFTER_MS = 2000;

interface Conn {
  userId: string;
  name: string;
  canEdit: boolean;
  docId: string;
  companyId: string;
  /** When the room last checked that the person is still in the company, in milliseconds. */
  checkedAt: number;
  /** Awareness client ids that this connection controls, so they go away when it closes. */
  clients: number[];
}

let schema: ReturnType<typeof docSchema> | null = null;
const getSchema = () => (schema ??= docSchema());

export class DocsRoom extends DurableObject<DocsEnv> {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private loading: Promise<void> | null = null;
  private docId: string | null = null;
  private lastEditor: string | null = null;
  private lastSnapshot: string | null = null;

  constructor(ctx: DurableObjectState, env: DocsEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Accepts a WebSocket. Only the Worker calls this, after its access checks. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    const conn: Conn = {
      userId: request.headers.get("x-openact-user") ?? "",
      name: decodeURIComponent(request.headers.get("x-openact-name") ?? "").slice(0, 80),
      canEdit: request.headers.get("x-openact-can-edit") === "1",
      docId: request.headers.get("x-openact-doc") ?? "",
      companyId: request.headers.get("x-openact-company") ?? "",
      checkedAt: Date.now(),
      clients: []
    };
    if (!conn.docId) return new Response("Missing doc id.", { status: 400 });
    await this.ensureLoaded(conn.docId);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [conn.userId]);
    server.serializeAttachment(conn);

    // Start the sync: send our state vector, then the people who are here now.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc!);
    server.send(encoding.toUint8Array(enc));
    const states = [...this.awareness!.getStates().keys()];
    if (states.length) server.send(this.awarenessMessage(states));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") return; // Pings get an automatic answer. Other text is not part of the protocol.
    const conn = ws.deserializeAttachment() as Conn | null;
    if (!conn) return ws.close(1008, "Unknown connection");
    // Once a minute, check that the person is still in the company. Someone who was removed loses the connection.
    if (Date.now() - conn.checkedAt > 60_000) {
      const still = await this.env.DB.prepare("SELECT 1 AS x FROM company_members WHERE company_id = ? AND user_id = ?")
        .bind(conn.companyId, conn.userId)
        .first();
      if (!still) return ws.close(4403, "Access removed");
      conn.checkedAt = Date.now();
      ws.serializeAttachment(conn);
    }
    await this.ensureLoaded(conn.docId);
    const data = new Uint8Array(message);
    const kind = messageKind(data);
    if (kind === "bad") return;
    if (kind === "write" && !conn.canEdit) return; // People who can only read never change the doc.

    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      if (kind === "write") this.lastEditor = conn.userId;
      syncProtocol.readSyncMessage(decoder, enc, this.doc!, ws);
      // A sync step 1 gets a step 2 back. Updates get nothing back.
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness!, decoding.readVarUint8Array(decoder), ws);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropConnection(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropConnection(ws);
  }

  /** Saves the shared doc and the D1 copy a short time after the last change. */
  async alarm(): Promise<void> {
    const docId = this.docId ?? (await this.ctx.storage.get<string>("docId"));
    if (!docId) return;
    await this.ensureLoaded(docId);
    await this.persist();
  }

  /** Closes the connections of someone who lost access. */
  async disconnect(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) ws.close(4403, "Access removed");
  }

  /* Loading and saving */

  private ensureLoaded(docId: string): Promise<void> {
    if (this.doc) return Promise.resolve();
    this.loading ??= this.load(docId).finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(docId: string): Promise<void> {
    this.docId = docId;
    const doc = new Y.Doc();
    const count = (await this.ctx.storage.get<number>("parts")) ?? 0;
    const pending = await this.ctx.storage.list<Uint8Array>({ prefix: "upd:" });
    if (count > 0 || pending.size > 0) {
      if (count > 0) {
        const parts = await this.ctx.storage.get<Uint8Array>(Array.from({ length: count }, (_, i) => `part:${i}`));
        Y.applyUpdate(doc, fromChunks(Array.from({ length: count }, (_, i) => parts.get(`part:${i}`) ?? new Uint8Array(0))));
      }
      for (const u of pending.values()) Y.applyUpdate(doc, u);
    } else {
      // A new room starts from the saved doc in D1.
      const row = await this.env.DB.prepare("SELECT content FROM docs_docs WHERE id = ?").bind(docId).first<{ content: string }>();
      let json = EMPTY_DOC;
      try {
        if (row) json = sanitizeDoc(JSON.parse(row.content));
      } catch {
        json = EMPTY_DOC;
      }
      prosemirrorJSONToYXmlFragment(getSchema(), json, doc.getXmlFragment(FIELD));
      this.lastSnapshot = JSON.stringify(json);
      await this.ctx.storage.put("docId", docId);
    }

    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // The room itself has no cursor.

    // Send every change to every open editor, and save soon.
    doc.on("update", (update: Uint8Array) => {
      // Save the change at once. Durable Object output gates hold the broadcast until the write is safe.
      void this.ctx.storage.put(`upd:${Date.now().toString(36)}:${crypto.randomUUID()}`, update);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc));
      void this.scheduleSave();
    });

    awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (origin && typeof origin === "object" && "serializeAttachment" in origin) {
        // Remember which awareness ids this connection controls. Attachments survive hibernation.
        const ws = origin as WebSocket;
        const conn = ws.deserializeAttachment() as Conn | null;
        if (conn) {
          const ids = new Set(conn.clients);
          for (const id of added) ids.add(id);
          for (const id of removed) ids.delete(id);
          conn.clients = [...ids];
          ws.serializeAttachment(conn);
        }
      }
      if (changed.length) this.broadcast(this.awarenessMessage(changed));
    });

    this.doc = doc;
    this.awareness = awareness;
  }

  private awarenessMessage(ids: number[]): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness!, ids));
    return encoding.toUint8Array(enc);
  }

  private broadcast(data: Uint8Array): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        /* The socket closed while we sent. */
      }
    }
  }

  private async scheduleSave(): Promise<void> {
    const at = await this.ctx.storage.getAlarm();
    if (at === null) await this.ctx.storage.setAlarm(Date.now() + SAVE_AFTER_MS);
  }

  private async dropConnection(ws: WebSocket): Promise<void> {
    const conn = ws.deserializeAttachment() as Conn | null;
    if (conn && this.awareness && conn.clients.length) awarenessProtocol.removeAwarenessStates(this.awareness, conn.clients, null);
    try {
      ws.close(1000, "Closed");
    } catch {
      /* Already closed. */
    }
    // When the last editor leaves, save now.
    if (this.ctx.getWebSockets().filter((s) => s !== ws).length === 0) await this.persist();
  }

  /** Saves the shared doc in parts, then writes a cleaned JSON copy to D1 when the content changed. */
  private async persist(): Promise<void> {
    if (!this.doc || !this.docId) return;
    // Fold the single changes saved so far into one copy. Changes that arrive meanwhile stay as single changes.
    const folded = [...(await this.ctx.storage.list({ prefix: "upd:" })).keys()];
    const state = Y.encodeStateAsUpdate(this.doc);
    const parts = toChunks(state);
    const old = (await this.ctx.storage.get<number>("parts")) ?? 0;
    const entries: Record<string, unknown> = { parts: parts.length };
    parts.forEach((p, i) => (entries[`part:${i}`] = p));
    entries.docId = this.docId;
    await this.ctx.storage.put(entries);
    for (let i = 0; i < folded.length; i += 128) await this.ctx.storage.delete(folded.slice(i, i + 128));
    if (old > parts.length) await this.ctx.storage.delete(Array.from({ length: old - parts.length }, (_, i) => `part:${parts.length + i}`));

    let json: string;
    try {
      json = JSON.stringify(sanitizeDoc(yXmlFragmentToProsemirrorJSON(this.doc.getXmlFragment(FIELD))));
    } catch (e) {
      console.error("[openact] docs room could not read the shared doc", e);
      return;
    }
    if (json === this.lastSnapshot) return;
    if (new TextEncoder().encode(json).length > CONTENT_MAX_BYTES) {
      console.warn(`[openact] doc ${this.docId} is too large to save a copy to D1`);
      return;
    }
    const iso = new Date().toISOString();
    const res = await this.env.DB.prepare(
      "UPDATE docs_docs SET content = ?, rev = rev + 1, updated_by = COALESCE(?, updated_by), updated_at = ? WHERE id = ? RETURNING company_id"
    )
      .bind(json, this.lastEditor, iso, this.docId)
      .first<{ company_id: string }>();
    if (!res) {
      // The doc was deleted. Forget it, and close the editors.
      await this.ctx.storage.deleteAll();
      for (const ws of this.ctx.getWebSockets()) ws.close(4404, "Doc deleted");
      this.doc = null;
      return;
    }
    this.lastSnapshot = json;
    // Tell open library pages that the doc changed.
    const lib = await this.env.DB.prepare(
      "INSERT INTO docs_library (company_id, rev) VALUES (?, 1) ON CONFLICT (company_id) DO UPDATE SET rev = rev + 1 RETURNING rev"
    )
      .bind(res.company_id)
      .first<{ rev: number }>();
    if (lib && this.env.PROJECT_ROOMS) {
      await this.env.PROJECT_ROOMS.get(this.env.PROJECT_ROOMS.idFromName(`docs-library:${res.company_id}`))
        .notify(lib.rev)
        .catch(() => {});
    }
  }
}
