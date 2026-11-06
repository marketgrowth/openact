import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText, usePath, useToast, useWorkspace } from "@openact/ui";
import type { ProjectSummary, RecentTask } from "../shared/types";

/** The projects of the current company, for the side panel and the projects page. */
export interface ProjectsState {
  projects: ProjectSummary[] | null;
  /** Tasks the person opened lately in this company, newest first. */
  recentTasks: RecentTask[];
  /** Loads the current company's projects again. */
  reloadProjects: () => void;
  /** Opens the dialog that creates a project. */
  newProject: () => void;
  /** Pins a project to the top of the side panel, or unpins it. */
  setPinned: (projectId: string, pinned: boolean) => Promise<void>;
  /** Adds a task to the Recent list. */
  noteTaskOpened: (projectId: string, taskId: string) => void;
}

const Ctx = createContext<ProjectsState | null>(null);

export function useProjects(): ProjectsState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useProjects needs the projects app's provider.");
  return s;
}

export function ProjectsProvider({ children, onNewProject }: { children: ReactNode; onNewProject: () => void }) {
  const { current } = useWorkspace();
  const path = usePath();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const seq = useRef(0);
  const companyId = current?.id ?? null;

  const load = useCallback((id: string | null) => {
    const n = ++seq.current;
    if (!id) {
      setProjects([]);
      setRecentTasks([]);
      return;
    }
    api<{ projects: ProjectSummary[]; recentTasks: RecentTask[] }>(`/api/projects?company=${encodeURIComponent(id)}`)
      .then((r) => {
        if (n !== seq.current) return;
        setProjects(r.projects);
        setRecentTasks(r.recentTasks ?? []);
      })
      .catch(() => n === seq.current && setProjects([]));
  }, []);

  // A new company shows its own projects at once.
  useEffect(() => {
    setProjects(null);
    setRecentTasks([]);
    load(companyId);
  }, [companyId, load]);

  // Keep the list fresh when the person moves around.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    load(companyId);
  }, [path]);

  const setPinned = useCallback(
    async (projectId: string, pinned: boolean) => {
      // Show the change at once, then save it.
      const at = pinned ? new Date().toISOString() : null;
      setProjects((ps) => ps?.map((p) => (p.id === projectId ? { ...p, pinnedAt: at } : p)) ?? ps);
      try {
        await api(`/api/projects/${projectId}/pin`, { method: pinned ? "PUT" : "DELETE" });
      } catch (err) {
        toast(errorText(err));
        load(companyId);
      }
    },
    [toast, load, companyId]
  );

  const noteTaskOpened = useCallback(
    (projectId: string, taskId: string) => {
      api(`/api/projects/${projectId}/tasks/${taskId}/opened`, { method: "POST" })
        .then(() => load(companyId))
        .catch(() => {
          /* The Recent list is a convenience. A failed save changes nothing else. */
        });
    },
    [load, companyId]
  );

  const value = useMemo<ProjectsState>(
    () => ({ projects, recentTasks, reloadProjects: () => load(companyId), newProject: onNewProject, setPinned, noteTaskOpened }),
    [projects, recentTasks, load, companyId, onNewProject, setPinned, noteTaskOpened]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
