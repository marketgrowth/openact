import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/* The mockup's state. It lives in memory only, so a reload starts again. */

interface OrbyttState {
  connected: boolean;
  connect: () => void;
  shortlist: string[];
  toggleShortlist: (talentId: string) => void;
  query: string;
  setQuery: (q: string) => void;
}

const Ctx = createContext<OrbyttState | null>(null);

export function useOrbytt(): OrbyttState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useOrbytt needs the Orbytt provider.");
  return s;
}

export function OrbyttProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [shortlist, setShortlist] = useState<string[]>(["T-1042", "T-1187"]);
  const [query, setQuery] = useState("");
  const value = useMemo<OrbyttState>(
    () => ({
      connected,
      connect: () => setConnected(true),
      shortlist,
      toggleShortlist: (id) => setShortlist((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
      query,
      setQuery
    }),
    [connected, shortlist, query]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
