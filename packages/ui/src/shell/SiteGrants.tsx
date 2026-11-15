import { useEffect, useState } from "react";
import { utcDay, type GrantUser, type SiteGrants as SiteGrantsData } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { Input } from "@openact/ui/components/input";
import { Switch } from "@openact/ui/components/switch";
import { Separator } from "@openact/ui/components/separator";

/*
 * Site settings > Paid app access. A super admin gives one person a paid app, such as Docs, without a paid plan.
 * The app unlocks in every company where the person is an owner.
 */
export function SiteGrants() {
  const toast = useToast();
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SiteGrantsData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(
      () => {
        api<SiteGrantsData>(`/api/site/grants${q.length >= 2 ? `?q=${encodeURIComponent(q)}` : ""}`)
          .then(setData)
          .catch((err) => toast(errorText(err)));
      },
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
  }, [query, toast]);

  if (!data) return null;
  if (!data.apps.length) {
    if (!data.needsLicense) return null;
    return (
      <>
        <Separator />
        <Field label="Paid app access">
          <p className="text-sm text-muted-foreground" data-site-grants-license="">
            To give one person a paid app, this site needs a license key from MarketGrowth that allows grants. Put the key in the OPENACT_LICENSE secret.
          </p>
        </Field>
      </>
    );
  }

  const replace = (u: GrantUser) => setData((d) => d && { ...d, users: d.users.map((x) => (x.id === u.id ? u : x)) });

  const save = async (user: GrantUser, appId: string, appName: string, on: boolean, endsOn: string | null = null) => {
    setBusy(true);
    try {
      const path = `/api/site/grants/${encodeURIComponent(user.id)}/${encodeURIComponent(appId)}`;
      const next = await api<GrantUser>(path, on ? { method: "PUT", body: { endsOn } } : { method: "DELETE" });
      replace(next);
      await ws.reloadAccess();
      const who = user.name || user.email;
      toast(
        !on
          ? `${who} no longer has ${appName}.`
          : next.ownerOf
            ? `${who} has ${appName}${endsOn ? ` through ${endsOn}` : ""}.`
            : `${who} has ${appName}. It unlocks when they own a company.`
      );
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const searching = query.trim().length >= 2;

  return (
    <>
      <Separator />
      <Field
        label="Paid app access"
        htmlFor="site-grant-search"
        help="Give one person a paid app without a paid plan. The app unlocks in each company they own, for everyone in it. Leave the end day empty to keep it on."
      >
        <div className="grid gap-3" data-site-grants="">
          <Input
            id="site-grant-search"
            type="search"
            value={query}
            placeholder="Find a person by name or email"
            onChange={(e) => setQuery(e.target.value)}
          />
          {!data.users.length ? (
            <p className="text-sm text-muted-foreground">
              {searching ? "Nobody on this site matches." : "Nobody has a paid app from you yet. Find a person to start."}
            </p>
          ) : (
            <ul className="grid gap-2">
              {data.users.map((u) => (
                <li key={u.id} className="grid gap-2 rounded-lg border p-3" data-site-grant-user={u.email}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.name || u.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.name ? `${u.email} · ` : ""}
                      {u.ownerOf ? `Owner of ${u.ownerOf} ${u.ownerOf === 1 ? "company" : "companies"}` : "Owns no company yet"}
                    </p>
                  </div>
                  {data.apps.map((a) => {
                    const g = u.grants.find((x) => x.appId === a.id);
                    return (
                      <div key={a.id} className="flex flex-wrap items-center gap-3" data-site-grant={a.id}>
                        <Switch
                          checked={!!g?.active}
                          disabled={busy}
                          onCheckedChange={(on) => save(u, a.id, a.name, on)}
                          aria-label={`${a.name} for ${u.name || u.email}`}
                        />
                        <span className="flex-1 text-sm">{a.name}</span>
                        {g?.active && (
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            Ends
                            <Input
                              type="date"
                              className="h-8 w-40"
                              min={utcDay()}
                              defaultValue={g.endsOn ?? ""}
                              disabled={busy}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === (g.endsOn ?? "") || (v && v.length !== 10)) return;
                                save(u, a.id, a.name, true, v || null);
                              }}
                              aria-label={`Last day of ${a.name} for ${u.name || u.email}`}
                            />
                          </label>
                        )}
                        {g && !g.active && <span className="text-xs text-muted-foreground">{`Ended ${g.endsOn}`}</span>}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>
    </>
  );
}
