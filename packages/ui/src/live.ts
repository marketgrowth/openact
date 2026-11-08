import { useEffect, useRef, useState } from "react";

export interface Viewer {
  userId: string;
  name: string;
}

type LiveMessage = { type: "rev"; rev: number } | { type: "presence"; viewers: Viewer[] };

const PING_MS = 55_000;
const MAX_BACKOFF_MS = 20_000;

/**
 * Live updates for one room over a WebSocket. `path` is the app's live route, such as /api/projects/ID/live.
 * - onRev runs with the project's revision when it changes on the server.
 * - `connected` is false while the socket is down. The page then polls, as before.
 * - The socket closes when the tab is hidden for a while and opens again when it is visible.
 */
export function useLive(path: string, enabled: boolean, onRev: (rev: number) => void): { connected: boolean; viewers: Viewer[] } {
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const onRevRef = useRef(onRev);
  onRevRef.current = onRev;

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let backoff = 1000;
    let retry: number | undefined;
    let ping: number | undefined;
    let hiddenTimer: number | undefined;

    const connect = () => {
      if (stopped || ws) return;
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
      try {
        ws = new WebSocket(url);
      } catch {
        schedule();
        return;
      }
      ws.onopen = () => {
        backoff = 1000;
        setConnected(true);
        ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string" || e.data === "pong") return;
        let msg: LiveMessage;
        try {
          msg = JSON.parse(e.data) as LiveMessage;
        } catch {
          return;
        }
        if (msg.type === "rev") onRevRef.current(msg.rev);
        else if (msg.type === "presence") setViewers(msg.viewers);
      };
      ws.onclose = (e) => {
        window.clearInterval(ping);
        ws = null;
        setConnected(false);
        setViewers([]);
        // 4403: access was removed. The next reload shows the access page, so do not reconnect.
        if (e.code !== 4403) schedule();
      };
      ws.onerror = () => ws?.close();
    };

    const schedule = () => {
      if (stopped || document.visibilityState !== "visible") return;
      window.clearTimeout(retry);
      retry = window.setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(hiddenTimer);
        if (!ws) {
          backoff = 1000;
          connect();
        }
      } else {
        // A tab in the background does not need live updates. Close after a minute to save connections.
        hiddenTimer = window.setTimeout(() => ws?.close(1000, "Hidden"), 120_000);
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      window.clearTimeout(hiddenTimer);
      window.clearInterval(ping);
      document.removeEventListener("visibilitychange", onVisibility);
      ws?.close(1000, "Left the project");
    };
  }, [path, enabled]);

  return { connected, viewers };
}
