import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, errorText, useAppOn, useLive, usePath, useWorkspace } from "@openact/ui";
import { API, ESIGN_HOME, type EsignHome } from "../shared/types";

/*
 * The current company's eSign state, for the side panel and the pages.
 * It loads only while an eSign page is open. Live updates raise `rev`, so pages load again.
 */

export interface EsignState {
  home: EsignHome | null;
  companyId: string | null;
  error: string | null;
  /** Goes up when templates or documents change, here or on another screen. */
  rev: number;
  reload: () => Promise<void>;
}

const Ctx = createContext<EsignState | null>(null);

export function useEsign(): EsignState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useEsign needs the eSign provider.");
  return s;
}

export function EsignProvider({ children }: { children: ReactNode }) {
  const { current } = useWorkspace();
  const on = useAppOn("esign");
  const path = usePath();
  const active = on && !!current && (path === ESIGN_HOME || path.startsWith(`${ESIGN_HOME}/`));
  const companyId = current?.id ?? null;
  const [home, setHome] = useState<EsignHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!companyId) return;
    const n = ++seq.current;
    try {
      const h = await api<EsignHome>(`${API}/companies/${companyId}/home`);
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

  useLive(`${API}/companies/${encodeURIComponent(companyId ?? "")}/live`, active && !!home, () => {
    setRev((r) => r + 1);
    void reload();
  });

  const value = useMemo<EsignState>(() => ({ home, companyId, error, rev, reload }), [home, companyId, error, rev, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Loads a page's data from the API, and again when `url` or `rev` changes. */
export function useLoad<T>(url: string | null, rev = 0): { data: T | null; error: string | null; reload: () => Promise<void> } {
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
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload, rev]);
  return { data, error, reload };
}

/** The colors of signer roles, by position. They come from the avatar tokens, so they work in light and dark. */
export const roleColor = (index: number) => `var(--av-${((index % 8) + 8) % 8})`;
/** A light fill of a role color for field boxes. */
export const roleFill = (index: number) => `color-mix(in srgb, ${roleColor(index)} 14%, transparent)`;
