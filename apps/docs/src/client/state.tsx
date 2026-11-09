import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, errorText, useAppOn, useLive, usePath, useWorkspace } from "@openact/ui";
import type { Category, Folder, Library, Tag } from "../shared/types";

/*
 * The current company's doc library, for the side panel and the pages.
 * It loads only while a Docs page is open, and a live room reloads it when someone changes the library.
 */

export const DOCS_HOME = "/a/docs";

export interface DocsState {
  library: Library | null;
  error: string | null;
  reload: () => Promise<void>;
  folder: (id: string | null | undefined) => Folder | undefined;
  category: (id: string | null | undefined) => Category | undefined;
  tag: (id: string | null | undefined) => Tag | undefined;
  /** The folders from the top level down to this folder. */
  folderTrail: (id: string | null | undefined) => Folder[];
}

const Ctx = createContext<DocsState | null>(null);

export function useDocs(): DocsState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useDocs needs the Docs provider.");
  return s;
}

export function DocsProvider({ children }: { children: ReactNode }) {
  const { current } = useWorkspace();
  const on = useAppOn("docs");
  const path = usePath();
  const active = on && !!current && (path === DOCS_HOME || path.startsWith(`${DOCS_HOME}/`));
  const companyId = current?.id ?? null;
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef(-1);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!companyId) return;
    const n = ++seq.current;
    try {
      const lib = await api<Library>(`/api/apps/docs/companies/${companyId}/library`);
      if (n !== seq.current) return;
      revRef.current = lib.rev;
      setLibrary(lib);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError(e instanceof ApiError && e.status === 403 ? e.message : errorText(e));
    }
  }, [companyId]);

  // A new company shows its own library.
  useEffect(() => {
    setLibrary(null);
    setError(null);
    revRef.current = -1;
  }, [companyId]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  const live = useLive(`/api/apps/docs/companies/${encodeURIComponent(companyId ?? "")}/live`, active, (rev) => {
    if (rev !== revRef.current) void reload();
  });

  // Without live updates, check now and then while a Docs page is open.
  useEffect(() => {
    if (!active || live.connected) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && void reload(), 15000);
    return () => window.clearInterval(t);
  }, [active, live.connected, reload]);

  const value = useMemo<DocsState>(() => {
    const folders = new Map((library?.folders ?? []).map((f) => [f.id, f]));
    const cats = new Map((library?.categories ?? []).map((c) => [c.id, c]));
    const tags = new Map((library?.tags ?? []).map((t) => [t.id, t]));
    return {
      library,
      error,
      reload,
      folder: (id) => (id ? folders.get(id) : undefined),
      category: (id) => (id ? cats.get(id) : undefined),
      tag: (id) => (id ? tags.get(id) : undefined),
      folderTrail: (id) => {
        const trail: Folder[] = [];
        const seen = new Set<string>();
        let f = id ? folders.get(id) : undefined;
        while (f && !seen.has(f.id)) {
          seen.add(f.id);
          trail.unshift(f);
          f = f.parentId ? folders.get(f.parentId) : undefined;
        }
        return trail;
      }
    };
  }, [library, error, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
