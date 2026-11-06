import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useWorkspace } from "@openact/ui";

/*
 * The mockup's state. It lives in memory only, so a reload starts again.
 * Each company has its own connection and shortlist, as in the real app: one Orbytt employer account per company.
 */

interface OrbyttState {
  connected: boolean;
  connect: () => void;
  shortlist: string[];
  toggleShortlist: (talentId: string) => void;
  query: string;
  setQuery: (q: string) => void;
  /** The talent whose profile is open in the side drawer, or null. */
  profileId: string | null;
  openProfile: (talentId: string | null) => void;
}

const Ctx = createContext<OrbyttState | null>(null);

export function useOrbytt(): OrbyttState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useOrbytt needs the Orbytt provider.");
  return s;
}

const DEFAULT_SHORTLIST = ["T-1042", "T-1187"];

export function OrbyttProvider({ children }: { children: ReactNode }) {
  const companyId = useWorkspace().current?.id ?? "";
  const [connectedBy, setConnectedBy] = useState<Record<string, boolean>>({});
  const [shortlistBy, setShortlistBy] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [profileId, openProfile] = useState<string | null>(null);
  const shortlist = shortlistBy[companyId] ?? DEFAULT_SHORTLIST;
  const value = useMemo<OrbyttState>(
    () => ({
      connected: !!connectedBy[companyId],
      connect: () => setConnectedBy((m) => ({ ...m, [companyId]: true })),
      shortlist,
      toggleShortlist: (id) =>
        setShortlistBy((m) => {
          const list = m[companyId] ?? DEFAULT_SHORTLIST;
          return { ...m, [companyId]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
        }),
      query,
      setQuery,
      profileId,
      openProfile
    }),
    [companyId, connectedBy, shortlist, query, profileId]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
