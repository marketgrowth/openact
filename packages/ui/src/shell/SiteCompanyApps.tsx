import { useEffect, useState } from "react";
import type { SiteCompanies, SiteCompanyApps as Company } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { Input } from "@openact/ui/components/input";
import { Switch } from "@openact/ui/components/switch";

/*
 * Site settings > Apps > One company. A super admin turns an app off for one company and leaves it on for the others.
 * The company's owners and admins cannot turn it on again. Its data stays.
 */
export function SiteCompanyApps({ siteOff }: { siteOff: readonly string[] }) {
  const toast = useToast();
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SiteCompanies | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(
      () => {
        api<SiteCompanies>(`/api/site/companies${q.length >= 2 ? `?q=${encodeURIComponent(q)}` : ""}`)
          .then(setData)
          .catch((err) => toast(errorText(err)));
      },
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
  }, [query, toast]);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const save = async (company: Company, appId: string, appName: string, available: boolean) => {
    setBusy(true);
    try {
      const path = `/api/site/companies/${encodeURIComponent(company.id)}/apps/${encodeURIComponent(appId)}`;
      const next = await api<Company>(path, { method: "PUT", body: { available } });
      setData((d) => d && { ...d, companies: d.companies.map((x) => (x.id === next.id ? next : x)) });
      if (company.id === ws.current?.id) await ws.reloadAccess();
      toast(available ? `${appName} is available in ${company.name}.` : `${appName} is off in ${company.name}. Other companies keep it.`);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const searching = query.trim().length >= 2;
  const more = !searching && data.total > data.companies.length;

  return (
    <Field
      label="Find a company"
      htmlFor="site-company-search"
      help="Type 2 or more letters of a company name. Turn an app off to remove it from that company only. Its owners and admins cannot turn it on again until you do."
    >
      <div className="grid gap-3" data-site-company-apps="">
        <Input
          id="site-company-search"
          type="search"
          value={query}
          placeholder="Find a company by name"
          onChange={(e) => setQuery(e.target.value)}
        />
        {!data.companies.length ? (
          <p className="text-sm text-muted-foreground">{searching ? "No company on this site matches." : "This site has no companies yet."}</p>
        ) : (
          <ul className="grid gap-2">
            {data.companies.map((co) => (
              <li key={co.id} className="grid gap-2 rounded-lg border p-3" data-site-company={co.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{co.name}</p>
                  <p className="text-xs text-muted-foreground">{`${co.members} ${co.members === 1 ? "person" : "people"}`}</p>
                </div>
                {data.apps.map((a) => {
                  const off = siteOff.includes(a.id);
                  const available = !co.blocked.includes(a.id);
                  return (
                    <div key={a.id} className="flex items-center gap-3" data-site-company-app={a.id}>
                      <Switch
                        checked={available && !off}
                        disabled={busy || off}
                        onCheckedChange={(on) => save(co, a.id, a.name, on)}
                        aria-label={`${a.name} in ${co.name}`}
                      />
                      <span className="flex-1 text-sm">{a.name}</span>
                      <span className="text-xs text-muted-foreground">{off ? "Off for the site" : available ? "Available" : "Off for this company"}</span>
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
        {more && (
          <p className="text-xs text-muted-foreground">{`Showing ${data.companies.length} of ${data.total} companies. Search to find the others.`}</p>
        )}
      </div>
    </Field>
  );
}
