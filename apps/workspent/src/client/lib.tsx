import { useCallback, useEffect, useState } from "react";
import { api, errorText, useWorkspace } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { cn } from "@openact/ui/lib/utils";
import { API, FLAG_LABELS, wallClock, type FlagId, type LocationInfo, type Me } from "../shared/rules";

/* Small helpers for the WorkSpent pages. */

export const companyApi = (companyId: string) => `${API}/companies/${companyId}`;

/** Loads a value from the API for the current company. Loads again when `reload` runs or the company changes. */
export function useCompanyData<T>(path: string | null): { data: T | null; error: string | null; reload: () => void; companyId: string | null } {
  const { current } = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const companyId = current?.id ?? null;
  useEffect(() => {
    if (!companyId || path === null) return;
    let live = true;
    setError(null);
    api<T>(`${companyApi(companyId)}${path}`).then(
      (d) => live && setData(d),
      (e) => live && setError(errorText(e))
    );
    return () => {
      live = false;
    };
  }, [companyId, path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, reload, companyId };
}

export function useMe() {
  return useCompanyData<Me>("/me");
}

/** "7:02 AM" in a time zone. */
export function timeText(iso: string | null, tz: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "Wed, Nov 18" for a YYYY-MM-DD date. */
export function dayText(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(date + "T00:00:00Z"));
}

/** "Nov 16 to Nov 29, 2026". */
export function periodText(p: { start: string; end: string }): string {
  const f = (d: string, year: boolean) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) }).format(new Date(d + "T00:00:00Z"));
  return `${f(p.start, false)} to ${f(p.end, true)}`;
}

/** The local date and time of an instant at a location, for a form. */
export function localParts(iso: string, tz: string): { date: string; time: string } {
  const w = wallClock(Date.parse(iso), tz);
  return { date: w.date, time: w.time };
}

/** The time zone name in a short form, such as "Pacific Time". */
export function zoneName(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Every time zone this browser knows, for a select. */
export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
  } catch {
    return ["UTC"];
  }
}

export function FlagBadges({ flags, className }: { flags: FlagId[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {[...new Set(flags)].map((f) => (
        <Badge key={f} variant="outline" className="border-warn-border bg-warn text-warn-foreground">
          {FLAG_LABELS[f]}
        </Badge>
      ))}
    </span>
  );
}

/** The locations this person can manage, and the one they picked last. */
export function useLocationPick(locations: LocationInfo[] | null): [string | null, (id: string) => void] {
  const key = "openact.workspent.location";
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const usable = (locations ?? []).filter((l) => l.canManage && !l.isArchived);
  const id = usable.some((l) => l.id === picked) ? picked : ((usable.find((l) => l.peopleCount > 0) ?? usable[0])?.id ?? null);
  const pick = useCallback((v: string) => {
    setPicked(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // Storage can be off. The choice then lasts for this page only.
    }
  }, []);
  return [id, pick];
}
