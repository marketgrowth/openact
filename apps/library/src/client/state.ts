import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, errorText, useWorkspace } from "@openact/ui";
import { API, HOME, type Format, type LibraryConfig, type ManageState, type Resource, type Term, type TermKind } from "../shared/rules";

/*
 * The Library's state in the web app. The config (settings, list values, canManage) loads once per company
 * and is shared by the panel and the pages. Call reloadConfig() after a manager changes settings, lists or To review.
 */

type Entry = { companyId: string; config: LibraryConfig | null; error: string | null };
let entry: Entry | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function fetchConfig(companyId: string) {
  try {
    const config = await api<LibraryConfig>(`${API}/companies/${companyId}/config`);
    entry = { companyId, config, error: null };
  } catch (e) {
    entry = { companyId, config: null, error: errorText(e) };
  }
  emit();
}

export function reloadConfig() {
  if (entry) void fetchConfig(entry.companyId);
}

/** The Library config for the current company, or null while it loads. */
export function useLibrary(): { config: LibraryConfig | null; error: string | null; companyId: string | null } {
  const { current } = useWorkspace();
  const id = current?.id ?? null;
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => entry
  );
  useEffect(() => {
    if (id && entry?.companyId !== id) {
      entry = { companyId: id, config: null, error: null };
      void fetchConfig(id);
    }
  }, [id]);
  const mine = snap && snap.companyId === id ? snap : null;
  return { config: mine?.config ?? null, error: mine?.error ?? null, companyId: id };
}

/** Visible values of one list, in order. */
export const visibleTerms = (terms: Term[], kind: TermKind) => terms.filter((t) => t.kind === kind && !t.isHidden).sort((a, b) => a.sortOrder - b.sortOrder);

/** The Manage state (super admins only). Pass enabled once the config says the person can manage, so readers make no call. */
export function useManage(enabled: boolean) {
  const [state, setState] = useState<ManageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!enabled) return;
    setError(null);
    api<ManageState>(`${API}/manage`).then(setState, (e) => setError(errorText(e)));
  }, [enabled]);
  useEffect(load, [load]);
  return { state, setState, error, reload: load };
}

/** Dates as readers see them: "Nov 18, 2026". */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const t = Date.parse(d.length === 10 ? d + "T00:00:00Z" : d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: d.length === 10 ? "UTC" : undefined });
}

/** "12 min ago", "Yesterday", or a date. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  if (h < 48) return "Yesterday";
  return fmtDate(iso);
}

export const FORMAT_ICON: Record<Format, string> = { document: "doc", link: "link", video: "video", article: "pencil" };

/** The page of a resource in the web app. */
export const resourcePath = (id: string) => `${HOME}/r/${encodeURIComponent(id)}`;

/** Where a reader opens the file of a published resource. Managers use the manage route, which also serves drafts. */
export const fileUrl = (r: Pick<Resource, "id">, companyId: string | null, manage = false) =>
  manage || !companyId ? `${API}/manage/files/${r.id}` : `${API}/companies/${companyId}/files/${r.id}`;

/** The image of a resource, through the app: the site's image policy allows only its own address. */
export const imageUrl = (r: Pick<Resource, "id" | "imageUrl">, companyId: string | null, manage = false) =>
  !r.imageUrl ? "" : manage || !companyId ? `${API}/manage/images/${r.id}` : `${API}/companies/${companyId}/images/${r.id}`;

/** Search params of the current address. */
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    (l) => {
      window.addEventListener("popstate", l);
      return () => window.removeEventListener("popstate", l);
    },
    () => location.search
  );
  return new URLSearchParams(search);
}
