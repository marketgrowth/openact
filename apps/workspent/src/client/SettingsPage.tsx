import { useEffect, useState } from "react";
import { Field, Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";
import { CURRENCIES, ROUNDING, type Kinds, type WorkSettings } from "../shared/projects";
import { companyApi, refreshMe, useCompanyData, useMe } from "./lib";

function Kind({ id, label, text, value, onChange }: { id: string; label: string; text: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-md border p-4">
      <Switch id={id} checked={value} onCheckedChange={onChange} className="mt-0.5" />
      <span className="grid gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

/** WorkSpent settings: which kinds of work are on, the currency and rounding, and the site default for the site owner. */
export default function SettingsPage() {
  const me = useMe();
  const s = useCompanyData<WorkSettings>(me.data?.canSetup ? "/settings" : null);
  const [kinds, setKinds] = useState<Kinds>({ projects: true, shifts: true });
  const [site, setSite] = useState<Kinds>({ projects: true, shifts: true });
  const [currency, setCurrency] = useState("USD");
  const [rounding, setRounding] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!s.data) return;
    setKinds({ projects: s.data.projects, shifts: s.data.shifts });
    setSite(s.data.site);
    setCurrency(s.data.currency);
    setRounding(s.data.roundingMinutes);
  }, [s.data]);

  async function save(path: "settings" | "site-kinds") {
    if (!s.companyId) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const body = path === "settings" ? { ...kinds, currency, roundingMinutes: rounding } : site;
      await api(`${companyApi(s.companyId)}/${path}`, { method: "PUT", body });
      setSaved(path === "settings" ? "Settings saved." : "Site default saved.");
      refreshMe();
      s.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader title="Settings" />
      <PageBody className="max-w-3xl">
        {me.data && !me.data.canSetup && <Notice tone="info">Only company owners and admins change WorkSpent settings.</Notice>}
        {s.error && <Notice tone="error">{s.error}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="info">{saved}</Notice>}
        {s.data && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Kinds of work</CardTitle>
                <CardDescription>
                  The side panel shows only the kinds of work that are on.
                  {s.data.fromSite ? " This company uses the site default now." : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Kind
                  id="ws-kind-projects"
                  label="Projects"
                  text="Time on projects for clients. People use a timer or type in hours. Hours have a rate, and clients approve each week."
                  value={kinds.projects}
                  onChange={(v) => setKinds({ ...kinds, projects: v })}
                />
                <Kind
                  id="ws-kind-shifts"
                  label="Shifts"
                  text="Time at a location on a schedule. Staff clock in with a PIN. Managers approve pay periods."
                  value={kinds.shifts}
                  onChange={(v) => setKinds({ ...kinds, shifts: v })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Currency" htmlFor="ws-currency">
                    <NativeSelect id="ws-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full">
                      {CURRENCIES.map((c) => (
                        <NativeSelectOption key={c} value={c}>
                          {c}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Round each project entry to" htmlFor="ws-rounding">
                    <NativeSelect id="ws-rounding" value={String(rounding)} onChange={(e) => setRounding(Number(e.target.value))} className="w-full">
                      {ROUNDING.map((r) => (
                        <NativeSelectOption key={r} value={String(r)}>
                          {r ? `${r} minutes` : "No rounding"}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
                <div>
                  <Button onClick={() => save("settings")} disabled={busy || (!kinds.projects && !kinds.shifts)}>
                    Save
                  </Button>
                </div>
                {!kinds.projects && !kinds.shifts && <p className="text-sm text-muted-foreground">Turn on Projects, Shifts or both.</p>}
              </CardContent>
            </Card>

            {s.data.canSetSite && (
              <Card>
                <CardHeader>
                  <CardTitle>Site default</CardTitle>
                  <CardDescription>For the site owner. Companies that made no choice above use these. Each company owner can change them.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Kind id="ws-site-projects" label="Projects" text="On for new companies." value={site.projects} onChange={(v) => setSite({ ...site, projects: v })} />
                  <Kind id="ws-site-shifts" label="Shifts" text="On for new companies." value={site.shifts} onChange={(v) => setSite({ ...site, shifts: v })} />
                  <div>
                    <Button variant="outline" onClick={() => save("site-kinds")} disabled={busy || (!site.projects && !site.shifts)}>
                      Save site default
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
