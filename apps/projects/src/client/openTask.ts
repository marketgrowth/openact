import { navigate } from "@openact/ui";

/*
 * Opens a task from anywhere in the app, for example from search results.
 * The project page picks it up when it loads, or at once when it is already open.
 */
const EVENT = "openact:open-task";
let pending: { projectId: string; taskId: string } | null = null;

export function requestOpenTask(projectId: string, taskId: string): void {
  pending = { projectId, taskId };
  const here = location.pathname === `/p/${projectId}` || location.pathname.startsWith(`/p/${projectId}/`);
  if (here) window.dispatchEvent(new CustomEvent(EVENT, { detail: pending }));
  else navigate(`/p/${projectId}`);
}

/** The task waiting to open in this project, if any. Reading it clears it. */
export function takePendingTask(projectId: string): string | null {
  if (!pending || pending.projectId !== projectId) return null;
  const id = pending.taskId;
  pending = null;
  return id;
}

export function onOpenTask(handler: (projectId: string, taskId: string) => void): () => void {
  const fn = (e: Event) => {
    const d = (e as CustomEvent<{ projectId: string; taskId: string }>).detail;
    pending = null;
    handler(d.projectId, d.taskId);
  };
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
