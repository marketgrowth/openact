import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, errorText, useAppOn, usePath, useWorkspace } from "@openact/ui";
import { ADVISORY_HOME, DEFAULT_SETTINGS } from "../shared/rules";
import type { AdvisoryHome, AdvisorySettings } from "../shared/types";

/*
 * The current company's advisor directory, for the side panel and the pages.
 * It loads only while an Advisory page is open.
 */

export const API = "/api/apps/advisory";

export interface AdvisoryState {
  home: AdvisoryHome | null;
  settings: AdvisorySettings;
  companyId: string | null;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<AdvisoryState | null>(null);

export function useAdvisory(): AdvisoryState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useAdvisory needs the Advisory provider.");
  return s;
}

export function AdvisoryProvider({ children }: { children: ReactNode }) {
  const { current } = useWorkspace();
  const on = useAppOn("advisory");
  const path = usePath();
  const active = on && !!current && (path === ADVISORY_HOME || path.startsWith(`${ADVISORY_HOME}/`));
  const companyId = current?.id ?? null;
  const [home, setHome] = useState<AdvisoryHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!companyId) return;
    const n = ++seq.current;
    try {
      const h = await api<AdvisoryHome>(`${API}/companies/${companyId}/home`);
      if (n !== seq.current) return;
      setHome(h);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError(e instanceof ApiError && e.status === 403 ? e.message : errorText(e));
    }
  }, [companyId]);

  useEffect(() => {
    setHome(null);
    setError(null);
  }, [companyId]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  const value = useMemo<AdvisoryState>(
    () => ({ home, settings: home?.settings ?? DEFAULT_SETTINGS, companyId, error, reload }),
    [home, companyId, error, reload]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Loads a page's data from the API, again when `key` changes. */
export function useLoad<T>(url: string | null): { data: T | null; error: string | null; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    try {
      const d = await api<T>(url);
      if (n !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError(errorText(e));
    }
  }, [url]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  return { data, error, reload };
}
