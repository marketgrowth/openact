import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, usePath, useWorkspace } from "@openact/ui";
import type { ProjectSummary } from "../shared/types";

/** The projects of the current company, for the side panel and the projects page. */
export interface ProjectsState {
  projects: ProjectSummary[] | null;
  /** Loads the current company's projects again. */
  reloadProjects: () => void;
  /** Opens the dialog that creates a project. */
  newProject: () => void;
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
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const seq = useRef(0);
  const companyId = current?.id ?? null;

  const load = useCallback((id: string | null) => {
    const n = ++seq.current;
    if (!id) {
      setProjects([]);
      return;
    }
    api<{ projects: ProjectSummary[] }>(`/api/projects?company=${encodeURIComponent(id)}`)
      .then((r) => n === seq.current && setProjects(r.projects))
      .catch(() => n === seq.current && setProjects([]));
  }, []);

  // A new company shows its own projects at once.
  useEffect(() => {
    setProjects(null);
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

  const value = useMemo<ProjectsState>(
    () => ({ projects, reloadProjects: () => load(companyId), newProject: onNewProject }),
    [projects, load, companyId, onNewProject]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
