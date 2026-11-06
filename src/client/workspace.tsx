import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Company, ProjectSummary } from "../shared/types";
import { api } from "./api";

/** The companies the person is in, the one they work in now, and its projects. */
export interface Workspace {
  companies: Company[] | null;
  current: Company | null;
  projects: ProjectSummary[] | null;
  /** Makes a company current. The server remembers it for the next visit. */
  switchTo: (id: string) => Promise<void>;
  /** Loads the company list again, for example after a rename or a new logo. */
  reloadCompanies: () => Promise<void>;
  /** Loads the current company's projects again. */
  reloadProjects: () => void;
}

const Ctx = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error("useWorkspace needs a WorkspaceProvider.");
  return ws;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const seq = useRef(0);

  const loadProjects = useCallback((companyId: string | null) => {
    const n = ++seq.current;
    if (!companyId) {
      setProjects([]);
      return;
    }
    api<{ projects: ProjectSummary[] }>(`/api/projects?company=${encodeURIComponent(companyId)}`)
      .then((r) => n === seq.current && setProjects(r.projects))
      .catch(() => n === seq.current && setProjects([]));
  }, []);

  const reloadCompanies = useCallback(async () => {
    const r = await api<{ companies: Company[]; currentId: string | null }>("/api/companies");
    setCompanies(r.companies);
    setCurrentId((cur) => {
      const next = cur && r.companies.some((c) => c.id === cur) ? cur : r.currentId;
      if (next !== cur) loadProjects(next);
      return next;
    });
  }, [loadProjects]);

  const switchTo = useCallback(
    async (id: string) => {
      setCurrentId(id);
      setProjects(null);
      loadProjects(id);
      await api(`/api/companies/${id}/switch`, { method: "POST" }).catch(() => {});
    },
    [loadProjects]
  );

  useEffect(() => {
    // A link such as /?company=ID (from a company invitation email) opens that company.
    const wanted = new URLSearchParams(location.search).get("company");
    api<{ companies: Company[]; currentId: string | null }>("/api/companies")
      .then((r) => {
        setCompanies(r.companies);
        const pick = wanted && r.companies.some((c) => c.id === wanted) ? wanted : r.currentId;
        setCurrentId(pick);
        loadProjects(pick);
        if (wanted && pick === wanted) {
          api(`/api/companies/${wanted}/switch`, { method: "POST" }).catch(() => {});
          history.replaceState(null, "", location.pathname);
        }
      })
      .catch(() => {
        setCompanies([]);
        setProjects([]);
      });
  }, [loadProjects]);

  const value = useMemo<Workspace>(
    () => ({
      companies,
      current: companies?.find((c) => c.id === currentId) ?? null,
      projects,
      switchTo,
      reloadCompanies,
      reloadProjects: () => loadProjects(currentId)
    }),
    [companies, currentId, projects, switchTo, reloadCompanies, loadProjects]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
