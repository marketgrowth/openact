import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Company, CompanyAccess } from "@openact/core/shared";
import { api } from "./api";

/** The companies the person is in, and the one they work in now. Apps keep their own data for the current company. */
export interface Workspace {
  companies: Company[] | null;
  current: Company | null;
  /** Makes a company current. The server remembers it for the next visit. */
  switchTo: (id: string) => Promise<void>;
  /** Loads the company list again, for example after a rename or a new logo. */
  reloadCompanies: () => Promise<void>;
  /** What the person can do in the current company: apps that are off, and their permissions. null while it loads. */
  access: CompanyAccess | null;
  /** Loads the access again, for example after Company settings change. */
  reloadAccess: () => Promise<void>;
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

  const reloadCompanies = useCallback(async () => {
    const r = await api<{ companies: Company[]; currentId: string | null }>("/api/companies");
    setCompanies(r.companies);
    setCurrentId((cur) => (cur && r.companies.some((c) => c.id === cur) ? cur : r.currentId));
  }, []);

  const switchTo = useCallback(async (id: string) => {
    setCurrentId(id);
    await api(`/api/companies/${id}/switch`, { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    // A link such as /?company=ID (from a company invitation email) opens that company.
    const wanted = new URLSearchParams(location.search).get("company");
    api<{ companies: Company[]; currentId: string | null }>("/api/companies")
      .then((r) => {
        setCompanies(r.companies);
        const pick = wanted && r.companies.some((c) => c.id === wanted) ? wanted : r.currentId;
        setCurrentId(pick);
        if (wanted && pick === wanted) {
          api(`/api/companies/${wanted}/switch`, { method: "POST" }).catch(() => {});
          history.replaceState(null, "", location.pathname);
        }
      })
      .catch(() => setCompanies([]));
  }, []);

  const [access, setAccess] = useState<CompanyAccess | null>(null);
  const accessSeq = useRef(0);
  const reloadAccess = useCallback(async () => {
    const n = ++accessSeq.current;
    if (!currentId) return setAccess(null);
    try {
      const a = await api<CompanyAccess>(`/api/companies/${currentId}/access`);
      if (n === accessSeq.current) setAccess(a);
    } catch {
      if (n === accessSeq.current) setAccess(null);
    }
  }, [currentId]);
  useEffect(() => {
    setAccess(null);
    reloadAccess();
  }, [reloadAccess]);

  const value = useMemo<Workspace>(
    () => ({ companies, current: companies?.find((c) => c.id === currentId) ?? null, switchTo, reloadCompanies, access, reloadAccess }),
    [companies, currentId, switchTo, reloadCompanies, access, reloadAccess]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * True when the person has the permission in the current company, such as "projects.create".
 * Use it to hide or turn off buttons. The server checks the permission again, so this is never the real check.
 */
export function useCan(permission: string): boolean {
  const { access } = useWorkspace();
  return !!access?.permissions.includes(permission);
}

/** True when the app is on in the current company. Apps count as on while the access loads. */
export function useAppOn(appId: string): boolean {
  const { access } = useWorkspace();
  return !access?.disabledApps.includes(appId);
}
