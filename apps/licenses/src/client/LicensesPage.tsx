import { useCallback, useEffect, useState } from "react";
import { Field, Icon, Notice, PageBody, SiteHeader, api, errorText, useToast } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { NativeSelect } from "@openact/ui/components/native-select";
import { Textarea } from "@openact/ui/components/textarea";
import { today, type Inspection, type IssuedLicense, type LicensesState, type SigningKey } from "../shared/rules";

/*
 * License Keys: make key pairs, issue license keys and check a key. Super admins only.
 * The page uses the Form pattern: one card per task, with Field rows.
 */

const BASE = "/api/apps/licenses";

const nextYear = () => {
  const d = today();
  return `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
};

const TIME_LABEL: Record<IssuedLicense["time"], string> = { valid: "Valid", grace: "In grace days", expired: "Expired" };

function useCopy() {
  const toast = useToast();
  return async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} is copied.`);
    } catch {
      toast(`Could not copy the ${what.toLowerCase()}. Select it and copy it by hand.`);
    }
  };
}

export default function LicensesPage() {
  const toast = useToast();
  const [data, setData] = useState<LicensesState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<LicensesState>(BASE).then(setData, (e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const run = async (path: string, body: unknown, done: string) => {
    try {
      setData(await api<LicensesState>(`${BASE}${path}`, { method: "POST", body }));
      toast(done);
      return true;
    } catch (e) {
      toast(errorText(e));
      return false;
    }
  };

  return (
    <>
      <SiteHeader title="License keys" />
      <PageBody>
        <div className="grid gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">License keys</h2>
          <p className="text-sm text-muted-foreground">
            Make key pairs and issue OpenAct license keys. The private keys stay on this site. Only super admins can open this page.
          </p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <IssueCard keys={data.signingKeys} onIssue={(body) => run("/licenses", body, "The license key is issued. Copy it from the list.")} />
            <LicenseList licenses={data.licenses} />
            <KeysCard keys={data.signingKeys} run={run} />
            <InspectCard />
          </div>
        )}
      </PageBody>
    </>
  );
}

function IssueCard({ keys, onIssue }: { keys: SigningKey[]; onIssue: (body: unknown) => Promise<boolean> }) {
  const usable = keys.filter((k) => !k.retiredAt);
  const [form, setForm] = useState({ kid: "", licensee: "", plan: "director", use: "plan", expiresAt: nextYear(), hosts: "", note: "" });
  const [busy, setBusy] = useState(false);
  const kid = form.kid || usable[0]?.kid || "";
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await onIssue({ ...form, kid })) setForm((f) => ({ ...f, licensee: "", hosts: "", note: "" }));
    setBusy(false);
  };

  return (
    <Card data-licenses-issue="">
      <CardHeader>
        <CardTitle>Issue a license key</CardTitle>
        <CardDescription>A deploy puts the key in its OPENACT_LICENSE secret. The deploy must run an OpenAct release that has the key pair's public key.</CardDescription>
      </CardHeader>
      <CardContent>
        {!usable.length ? (
          <p className="text-sm text-muted-foreground">Make a key pair first, under Key pairs.</p>
        ) : (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <Field label="Licensee" htmlFor="lic-licensee" help="Who the license is for, such as the company name.">
              <Input id="lic-licensee" value={form.licensee} maxLength={120} onChange={set("licensee")} required />
            </Field>
            <Field label="Key pair" htmlFor="lic-kid">
              <NativeSelect id="lic-kid" value={kid} onChange={set("kid")}>
                {usable.map((k) => (
                  <option key={k.kid} value={k.kid}>
                    {k.kid}
                    {k.released ? "" : " (not in a release yet)"}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Plan" htmlFor="lic-plan">
              <NativeSelect id="lic-plan" value={form.plan} onChange={set("plan")}>
                <option value="director">OpenAct Director</option>
                <option value="producer">OpenAct Producer</option>
              </NativeSelect>
            </Field>
            <Field
              label="Use"
              htmlFor="lic-use"
              help={
                form.use === "grants"
                  ? "No company gets the plan. Super admins can give the plan's apps to one person at a time."
                  : "Every company on the deploy gets the plan."
              }
            >
              <NativeSelect id="lic-use" value={form.use} onChange={set("use")}>
                <option value="plan">Plan for every company</option>
                <option value="grants">Grants only</option>
              </NativeSelect>
            </Field>
            <Field label="Last day" htmlFor="lic-expires" help="The key works through this day, then 14 grace days.">
              <Input id="lic-expires" type="date" min={today()} value={form.expiresAt} onChange={set("expiresAt")} required />
            </Field>
            <Field label="Host names" htmlFor="lic-hosts" help="Where the key works, such as app.gtmmatters.com. Separate names with commas. Empty: any host.">
              <Input id="lic-hosts" value={form.hosts} placeholder="app.example.com" onChange={set("hosts")} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note" htmlFor="lic-note" help="Only you see the note. For example, the invoice or the person who asked.">
                <Textarea id="lic-note" value={form.note} maxLength={500} rows={2} onChange={set("note")} />
              </Field>
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={busy || !form.licensee.trim()}>
                Issue license key
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function LicenseList({ licenses }: { licenses: IssuedLicense[] }) {
  const copy = useCopy();
  return (
    <Card data-licenses-list="">
      <CardHeader>
        <CardTitle>Issued license keys</CardTitle>
        <CardDescription>
          A key cannot be taken back after you send it. To stop a key, let it end, or make a new key pair and stop trusting the old one in a release.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!licenses.length ? (
          <p className="text-sm text-muted-foreground">No license keys yet.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {licenses.map((l) => (
              <li key={l.id} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border p-3" data-license={l.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.licensee}</span>
                  <Badge variant="secondary">{l.plan === "producer" ? "Producer" : "Director"}</Badge>
                  <Badge variant="outline">{l.use === "grants" ? "Grants only" : "Plan"}</Badge>
                  <Badge variant={l.time === "valid" ? "outline" : "secondary"}>{TIME_LABEL[l.time]}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {l.issuedAt} to {l.expiresAt} · {l.kid}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{l.hosts.length ? `Works on ${l.hosts.join(", ")}` : "Works on any host"}</p>
                {l.note && <p className="text-sm">{l.note}</p>}
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{l.license}</code>
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(l.license, "The license key")}>
                    <Icon name="copy" /> Copy
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function KeysCard({ keys, run }: { keys: SigningKey[]; run: (path: string, body: unknown, done: string) => Promise<boolean> }) {
  const copy = useCopy();
  const [kid, setKid] = useState(`mg-${today().slice(0, 4)}`);
  const [busy, setBusy] = useState(false);

  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await run("/signing-keys", { kid }, `The key pair ${kid} is ready. Add its public key to a release before you send licenses.`);
    setBusy(false);
  };

  return (
    <Card data-licenses-keys="">
      <CardHeader>
        <CardTitle>Key pairs</CardTitle>
        <CardDescription>
          This site makes each key pair and keeps the private key, sealed with AUTH_SECRET. A deploy trusts a key pair after you add its public key to
          LICENSE_PUBLIC_KEYS in packages/core/src/server/license-keys.ts and release OpenAct.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {keys.map((k) => (
          <div key={k.kid} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border p-3" data-signing-key={k.kid}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium">{k.kid}</span>
              <Badge variant={k.released ? "secondary" : "outline"}>{k.released ? "In this release" : "Not in this release"}</Badge>
              {k.retiredAt && <Badge variant="outline">Retired</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">
                {k.licenses} {k.licenses === 1 ? "license" : "licenses"} · made {k.createdAt.slice(0, 10)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{k.releaseLine}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => copy(k.releaseLine, "The release line")}>
                <Icon name="copy" /> Copy
              </Button>
              {!k.retiredAt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => run(`/signing-keys/${encodeURIComponent(k.kid)}/retire`, {}, `${k.kid} is retired. Its licenses keep working.`)}
                >
                  Retire
                </Button>
              )}
            </div>
          </div>
        ))}
        <form className="flex flex-wrap items-end gap-3" onSubmit={make}>
          <Field label="New key id" htmlFor="lic-new-kid" help="Lowercase letters, digits and dashes, such as mg-2026.">
            <Input id="lic-new-kid" value={kid} onChange={(e) => setKid(e.target.value)} className="w-48" />
          </Field>
          <Button type="submit" variant="outline" disabled={busy}>
            Make key pair
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function InspectCard() {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [result, setResult] = useState<Inspection | null>(null);

  const inspect = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setResult(await api<Inspection>(`${BASE}/inspect`, { method: "POST", body: { license: key } }));
    } catch (err) {
      setResult(null);
      toast(errorText(err));
    }
  };

  return (
    <Card data-licenses-inspect="">
      <CardHeader>
        <CardTitle>Check a license key</CardTitle>
        <CardDescription>Paste a key to read it and check its signature.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={inspect}>
          <Textarea value={key} rows={3} placeholder="oa1...." onChange={(e) => setKey(e.target.value)} aria-label="License key" className="font-mono text-xs" />
          <div className="flex justify-end">
            <Button type="submit" variant="outline" disabled={!key.trim()}>
              Check key
            </Button>
          </div>
        </form>
        {result && (
          <div className="mt-3 grid gap-2" data-licenses-inspection="">
            {result.problem && <Notice tone="error">{result.problem}</Notice>}
            <p className="text-sm">
              {result.signedHere === null ? "This site does not hold the key pair." : result.signedHere ? "Signed by a key pair on this site." : "The signature is not valid."}{" "}
              {result.trusted ? "This release of OpenAct trusts it." : "This release of OpenAct does not trust it."} {TIME_LABEL[result.time]}.
            </p>
            <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{JSON.stringify(result.payload, null, 2)}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
