import { useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { AnyExtension } from "@tiptap/core";
import { caretColor } from "../shared/collab";

/*
 * Live editing in the browser: a Yjs doc, a WebSocket to the doc's room, and a copy in IndexedDB for offline work.
 * Changes made offline stay on this device and sync when the connection comes back.
 */

export type CollabStatus = "connecting" | "live" | "offline";

export interface Collab {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  status: CollabStatus;
  /** True after the first sync with the room. */
  synced: boolean;
  /** Other people in the doc now. */
  peers: Array<{ userId: string; name: string }>;
  /** A reason when the room closed the connection for good, such as lost access or a deleted doc. */
  closed: string | null;
  extensions: AnyExtension[];
}

const dbName = (docId: string) => `openact-doc-${docId}`;

function create(docId: string, me: { id: string; name: string }) {
  const ydoc = new Y.Doc();
  const idb = new IndexeddbPersistence(dbName(docId), ydoc);
  const base = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/apps/docs/collab`;
  const provider = new WebsocketProvider(base, docId, ydoc, { maxBackoffTime: 10000 });
  const user = { id: me.id, name: me.name, color: caretColor(me.id) };
  const extensions: AnyExtension[] = [Collaboration.configure({ document: ydoc }), CollaborationCaret.configure({ provider, user })];
  return { ydoc, idb, provider, extensions };
}

export function useCollab(docId: string, enabled: boolean, me: { id: string; name: string }): Collab | null {
  const [parts] = useState(() => (enabled ? create(docId, me) : null));
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<Collab["peers"]>([]);
  const [closed, setClosed] = useState<string | null>(null);

  useEffect(() => {
    if (!parts) return;
    const { provider, idb, ydoc } = parts;
    const onStatus = ({ status: s }: { status: string }) => setStatus(s === "connected" ? "live" : s === "connecting" ? "connecting" : "offline");
    const onSync = (s: boolean) => s && setSynced(true);
    const onClose = (event: CloseEvent | null) => {
      // 4403: access removed. 4404: the doc was deleted. Stop, and forget the copy on this device.
      if (event && (event.code === 4403 || event.code === 4404)) {
        provider.disconnect();
        void idb.clearData();
        setClosed(event.code === 4404 ? "Someone deleted this doc." : "You no longer have access to this doc.");
      }
    };
    const onAwareness = () => {
      const seen = new Map<string, string>();
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === ydoc.clientID) return;
        const u = (state as { user?: { id?: string; name?: string } }).user;
        if (u?.id && u.id !== me.id) seen.set(u.id, String(u.name ?? "Someone").slice(0, 80));
      });
      setPeers([...seen].map(([userId, name]) => ({ userId, name })));
    };
    provider.on("status", onStatus);
    provider.on("sync", onSync);
    provider.on("connection-close", onClose);
    provider.awareness.on("change", onAwareness);
    const offline = () => setStatus("offline");
    window.addEventListener("offline", offline);
    return () => {
      provider.off("status", onStatus);
      provider.off("sync", onSync);
      provider.off("connection-close", onClose);
      provider.awareness.off("change", onAwareness);
      window.removeEventListener("offline", offline);
      provider.destroy();
      void idb.destroy();
      ydoc.destroy();
    };
  }, [parts, me.id]);

  if (!parts) return null;
  return { ydoc: parts.ydoc, provider: parts.provider, status, synced, peers, closed, extensions: parts.extensions };
}

/** Forgets the copy of a doc on this device, for example after the doc was deleted. */
export async function forgetLocalCopy(docId: string): Promise<void> {
  const idb = new IndexeddbPersistence(dbName(docId), new Y.Doc());
  await idb.clearData().catch(() => {});
}
