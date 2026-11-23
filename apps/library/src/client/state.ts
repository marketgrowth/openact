import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, errorText, useWorkspace } from "@openact/ui";
import { API, type LibraryConfig, type ManageState, type Term, type TermKind } from "../shared/rules";

/*
 * The Library's state in the web app. The config (brand settings, list items, canManage) loads once per company
 * and is shared by the panel and the pages. Call reloadConfig() after a super admin changes settings or lists.
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

/** Visible list items of one kind, in order. */
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

/** Today on this computer, as YYYY-MM-DD: the default published date of an update. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
