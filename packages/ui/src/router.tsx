import { createContext, useContext, useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import type { RouteParams } from "./app-paths.ts";

/*
 * The shell's router: the History API, with no library.
 * navigate() and <Link> change the page without a reload. usePath() follows the path. useParams() reads the route's named parts.
 * Back and Forward put the page back where it was scrolled. A new page starts at the top.
 */

const listeners = new Set<() => void>();

/* Scroll positions, one for each history entry. */

let currentKey = "";
const positions = new Map<string, number>();
let cancelRestore: (() => void) | null = null;
let started = false;

const newKey = () => Math.random().toString(36).slice(2, 10);

function entryKey(state: unknown): string | null {
  return state && typeof state === "object" && typeof (state as { key?: unknown }).key === "string" ? (state as { key: string }).key : null;
}

/** Puts a saved position back. Content can load after the page shows, so it tries for up to one second. The person's own scroll stops it. */
function restoreScroll(y: number) {
  cancelRestore?.();
  let frames = 0;
  let id = 0;
  const stop = () => {
    cancelAnimationFrame(id);
    for (const e of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(e, stop);
    if (cancelRestore === stop) cancelRestore = null;
  };
  const step = () => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) < 2 || ++frames > 60) return stop();
    id = requestAnimationFrame(step);
  };
  for (const e of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(e, stop, { passive: true });
  cancelRestore = stop;
  id = requestAnimationFrame(step);
}

/** Starts scroll tracking once, in the browser. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    history.scrollRestoration = "manual";
  } catch {
    /* Some browsers do not allow it. Their own restoration still works. */
  }
  currentKey = entryKey(history.state) ?? newKey();
  if (!entryKey(history.state)) history.replaceState({ ...(history.state ?? {}), key: currentKey }, "");
  let queued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        positions.set(currentKey, window.scrollY);
      });
    },
    { passive: true }
  );
  window.addEventListener("popstate", (e) => {
    currentKey = entryKey(e.state) ?? newKey();
    restoreScroll(positions.get(currentKey) ?? 0);
  });
}

function subscribe(fn: () => void) {
  start();
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
}

export function navigate(to: string, replace = false) {
  start();
  if (to === location.pathname + location.search) return;
  positions.set(currentKey, window.scrollY);
  cancelRestore?.();
  currentKey = newKey();
  if (replace) history.replaceState({ key: currentKey }, "", to);
  else history.pushState({ key: currentKey }, "", to);
  window.scrollTo(0, 0);
  listeners.forEach((f) => f());
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

/** Goes to another path when it shows, and replaces the current history entry. */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

/** The shell sets this around the page of the route that matched. */
export const RouteParamsContext = createContext<RouteParams>({});

/**
 * The named parts of the current route, such as { id: "abc", view: "timeline" } for "/p/:id/:view?".
 * A missing optional part is undefined. Values are URL-decoded.
 */
export function useParams<K extends string = string>(): Readonly<Partial<Record<K, string>>> {
  return useContext(RouteParamsContext) as Readonly<Partial<Record<K, string>>>;
}
