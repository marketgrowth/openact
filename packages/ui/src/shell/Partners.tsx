import { useCallback, useEffect, useState } from "react";
import type { PartnerClientPeople, PartnerClients, PartnerDomain, SiteCompanies, SiteCompanyApps as Company } from "@openact/core/shared";
import { COMPANY_ROLE_LABELS, PARTNER_NAME_MAX } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, Modal, Notice, useToast } from "../ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";

/*
 * Partner domains: white label for agencies and other partners. See docs/partners.md.
 * SitePartners: Site settings > Partner domains, for super admins. Manage opens the partner's settings (pause, own AI
 * keys) and its client companies, with a handover for a partner that is gone.
 * PartnerClientsTab: Company settings > Clients, for the partner's owners and admins on their own host.
 */

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const clientsLabel = (n: number) => `${n} client ${n === 1 ? "company" : "companies"}`;
const day = (iso: string) => iso.slice(0, 10);

export function SitePartners() {
  const toast = useToast();
  const [domains, setDomains] = useState<PartnerDomain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PartnerDomain | null>(null);
  const [managing, setManaging] = useState<PartnerDomain | null>(null);

  const load = useCallback(async () => {
    try {
      setDomains((await api<{ domains: PartnerDomain[] }>("/api/site/partners")).domains);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (d: PartnerDomain) => {
    try {
      await api(`/api/site/partners/${encodeURIComponent(d.host)}`, { method: "DELETE" });
      toast(`${d.host} is no longer a partner domain.`);
      await load();
    } catch (err) {
      toast(errorText(err));
    }
  };

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!domains) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-6">
      <div className="grid gap-2 text-sm text-muted-foreground">
        <p>A partner domain is another address for this site, such as app.brightline.com. On it, people see the partner company's name and logo, and the sign-in emails come from the partner's name.</p>
        <p>Point the host name at this Worker first. In Cloudflare, add it as a custom domain of the Worker, or as a custom hostname with Cloudflare for SaaS when the partner keeps its own DNS.</p>
        <p>Companies that the partner's owners and admins make on their domain are its client companies. Use the count to bill the partner.</p>
        <p>
          A partner brings its own AI keys: the partner and its clients never use this site's AI. To stop a partner without deleting anything, open Manage and
          pause it.
        </p>
      </div>
      <div>
        <Button type="button" onClick={() => setAdding(true)}>
          Add a partner domain
        </Button>
      </div>
      {!domains.length ? (
        <p className="text-sm text-muted-foreground">This site has no partner domains yet.</p>
      ) : (
        <ul className="grid gap-2" data-site-partners="">
          {domains.map((d) => (
            <li key={d.host} className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-site-partner={d.host}>
              {/* A minimum width lets the buttons wrap below the text on a phone. */}
              <div className="min-w-56 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="truncate">{d.host}</span>
                  {d.paused && <Badge variant="destructive">Paused</Badge>}
                  {!d.ownAiRequired && <Badge variant="secondary">Uses this site's AI</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`${d.name || d.companyName}${d.name ? ` (${d.companyName})` : ""} · ${clientsLabel(d.clients)} · since ${day(d.createdAt)}`}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setManaging(d)}>
                Manage
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(d)}>
                Rename
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => remove(d)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onAdded={async (d) => {
            setAdding(false);
            toast(`${d.host} now shows ${d.name || d.companyName}.`);
            await load();
          }}
        />
      )}
      {managing && (
        <ManageDialog
          domain={managing}
          onClose={() => setManaging(null)}
          onChanged={load}
        />
      )}
      {editing && (
        <RenameDialog
          domain={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            toast("The name is saved.");
            await load();
          }}
        />
      )}
    </div>
  );
}

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (d: PartnerDomain) => void }) {
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(
      () => {
        api<SiteCompanies>(`/api/site/companies${q.length >= 2 ? `?q=${encodeURIComponent(q)}` : ""}`)
          .then((r) => setCompanies(r.companies))
          .catch((err) => setError(errorText(err)));
      },
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
  }, [query]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      onAdded(await api<PartnerDomain>("/api/site/partners", { body: { host, companyId: company.id, name } }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a partner domain" description="People who open this host name see the partner's name and logo." onClose={busy ? () => undefined : onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <Field label="Host name" htmlFor="partner-host" help="Such as app.brightline.com. Point it at this Worker in Cloudflare.">
          <Input id="partner-host" required value={host} disabled={busy} placeholder="app.brightline.com" onChange={(e) => setHost(e.target.value)} />
        </Field>
        <Field label="Partner company" htmlFor="partner-company" help="The company whose logo shows on the host. Its owners and admins make the client companies.">
          <div className="grid gap-2">
            <Input id="partner-company" type="search" value={query} disabled={busy} placeholder="Find a company by name" onChange={(e) => setQuery(e.target.value)} />
            <ul className="grid max-h-48 gap-1 overflow-y-auto" data-partner-company-list="">
              {companies.map((co) => (
                <li key={co.id}>
                  <Button
                    type="button"
                    variant={company?.id === co.id ? "default" : "ghost"}
                    size="sm"
                    className="w-full justify-between"
                    aria-pressed={company?.id === co.id}
                    onClick={() => setCompany(co)}
                  >
                    <span className="truncate">{co.name}</span>
                    <span className="text-xs opacity-80">{people(co.members)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Field>
        <Field label="Name on the host" htmlFor="partner-name" help="Optional. Leave it empty to show the company name.">
          <Input id="partner-name" maxLength={PARTNER_NAME_MAX} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !host.trim() || !company}>
            {busy ? "Adding…" : "Add partner domain"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameDialog({ domain, onClose, onSaved }: { domain: PartnerDomain; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(domain.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/site/partners/${encodeURIComponent(domain.host)}`, { method: "PATCH", body: { name } });
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Rename ${domain.host}`} description={`Leave the name empty to show ${domain.companyName}.`} onClose={busy ? () => undefined : onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <Field label="Name on the host" htmlFor="partner-rename">
          <Input id="partner-rename" maxLength={PARTNER_NAME_MAX} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** One partner: pause, own AI keys, and its client companies with a handover. Settings apply to every host of the company. */
function ManageDialog({ domain, onClose, onChanged }: { domain: PartnerDomain; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const name = domain.name || domain.companyName;
  const [paused, setPaused] = useState(domain.paused);
  const [ownAi, setOwnAi] = useState(domain.ownAiRequired);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<PartnerClientPeople | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handover, setHandover] = useState<PartnerClientPeople["clients"][number] | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setData(await api<PartnerClientPeople>(`/api/site/partners/company/${domain.companyId}/clients`));
    } catch (err) {
      setError(errorText(err));
    }
  }, [domain.companyId]);
  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const save = async (body: { paused?: boolean; ownAiRequired?: boolean }) => {
    setBusy(true);
    try {
      const r = await api<{ paused: boolean; ownAiRequired: boolean }>(`/api/site/partners/company/${domain.companyId}`, { method: "PUT", body });
      setPaused(r.paused);
      setOwnAi(r.ownAiRequired);
      if (body.paused !== undefined) toast(r.paused ? `${name} is paused. Its host shows a paused page, and its apps are off.` : `${name} is on again.`);
      if (body.ownAiRequired !== undefined) toast(r.ownAiRequired ? `${name} and its clients use their own AI keys.` : `${name} and its clients can use this site's AI.`);
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Manage ${name}`} description={`These settings apply to ${domain.companyName} and every client company it made.`} onClose={onClose} wide>
      <div className="grid gap-6" data-partner-manage={domain.companyId}>
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="grid gap-1">
            <Label htmlFor="partner-paused">Paused</Label>
            <span className="text-xs text-muted-foreground">
              Its host shows a paused page, and every app is off for the partner and its clients. Nothing is deleted. Turn it off to start the service again.
            </span>
          </div>
          <Switch id="partner-paused" checked={paused} disabled={busy} onCheckedChange={(v) => save({ paused: v })} />
        </div>
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="grid gap-1">
            <Label htmlFor="partner-own-ai">Brings its own AI keys</Label>
            <span className="text-xs text-muted-foreground">
              On: the partner and its clients never use this site's AI or its keys, such as Jev. They add their own keys in Company settings, under AI provider.
              Off: this site pays for their AI.
            </span>
          </div>
          <Switch id="partner-own-ai" checked={ownAi} disabled={busy} onCheckedChange={(v) => save({ ownAiRequired: v })} />
        </div>
        <div className="grid gap-3">
          <h3 className="text-sm font-medium">Client companies</h3>
          {error && <Notice tone="error">{error}</Notice>}
          {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {data && !data.clients.length && <p className="text-sm text-muted-foreground">{name} has no client companies yet.</p>}
          {data && data.clients.length > 0 && (
            <ul className="grid gap-2" data-partner-client-list="">
              {data.clients.map((k) => {
                const owners = k.people.filter((p) => p.role === "owner");
                const clientOwner = owners.some((p) => !p.partnerPerson);
                return (
                  <li key={k.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-partner-client={k.id}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{k.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {`${people(k.people.length)} · since ${day(k.createdAt)} · ${clientOwner ? "the client is an owner" : `only ${name}'s people own it`}`}
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setHandover(k)}>
                      Hand over
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {handover && data && (
        <HandoverDialog
          partnerName={name}
          client={handover}
          onClose={() => setHandover(null)}
          onDone={async (released) => {
            setHandover(null);
            toast(released ? `${handover.name} is handed over and no longer a client of ${name}.` : `${handover.name} is handed over.`);
            await loadClients();
            await onChanged();
          }}
        />
      )}
    </Modal>
  );
}

/** Makes a person in a client company its owner. For a partner that is gone. */
function HandoverDialog({
  partnerName,
  client,
  onClose,
  onDone
}: {
  partnerName: string;
  client: PartnerClientPeople["clients"][number];
  onClose: () => void;
  onDone: (released: boolean) => void;
}) {
  const candidates = client.people.filter((p) => p.role !== "guest");
  const first = candidates.find((p) => !p.partnerPerson) ?? candidates[0];
  const [userId, setUserId] = useState(first?.userId ?? "");
  const [removePartnerPeople, setRemovePartnerPeople] = useState(false);
  const [release, setRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/site/partners/clients/${client.id}/handover`, { body: { userId, removePartnerPeople, release } });
      onDone(release);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Hand over ${client.name}`} description="The person you choose becomes an owner of the company. They can then manage it without the partner." onClose={busy ? () => undefined : onClose}>
      {!candidates.length ? (
        <Notice tone="info">This company has nobody who can become an owner. Ask the client to join it first.</Notice>
      ) : (
        <form className="grid gap-4" onSubmit={submit}>
          <Field label="New owner" htmlFor="handover-person" help="Guests cannot become owners.">
            <NativeSelect id="handover-person" value={userId} disabled={busy} onChange={(e) => setUserId(e.target.value)}>
              {candidates.map((p) => (
                <NativeSelectOption key={p.userId} value={p.userId}>
                  {`${p.name || p.email} (${p.email}), ${COMPANY_ROLE_LABELS[p.role].toLowerCase()}${p.partnerPerson ? `, from ${partnerName}` : ""}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-start gap-3">
            <Checkbox id="handover-remove" checked={removePartnerPeople} disabled={busy} onCheckedChange={(v) => setRemovePartnerPeople(v === true)} />
            <div className="grid gap-1">
              <Label htmlFor="handover-remove">Remove {partnerName}'s people from this company</Label>
              <p className="text-xs text-muted-foreground">Everyone who is also in {partnerName}'s company leaves this company. The new owner stays.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="handover-release" checked={release} disabled={busy} onCheckedChange={(v) => setRelease(v === true)} />
            <div className="grid gap-1">
              <Label htmlFor="handover-release">Take the company away from {partnerName}</Label>
              <p className="text-xs text-muted-foreground">
                It stops counting as {partnerName}'s client. A pause of {partnerName} no longer applies, and the company uses this site's AI like any other company.
              </p>
            </div>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !userId}>
              {busy ? "Handing over…" : "Hand over"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Company settings > Clients: the partner's host names and its client companies. */
export function PartnerClientsTab({ companyId }: { companyId: string }) {
  const [data, setData] = useState<PartnerClients | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PartnerClients>(`/api/companies/${companyId}/clients`)
      .then(setData)
      .catch((err) => setError(errorText(err)));
  }, [companyId]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-6" data-partner-clients="">
      <div className="grid gap-2 text-sm text-muted-foreground">
        <p>{data.hosts.length ? `Your clients sign in at ${data.hosts.join(" or ")}. They see your name and logo.` : "This company has no partner domain on this site."}</p>
        <p>To add a client, make a new company from the company menu, then invite the client to it in Company settings &gt; People. Invite them as an owner, so they are never locked out of their own company.</p>
      </div>
      {!data.clients.length ? (
        <p className="text-sm text-muted-foreground">You have no client companies yet.</p>
      ) : (
        <>
          <p className="text-sm font-medium">{clientsLabel(data.clients.length)}</p>
          <ul className="grid gap-2">
            {data.clients.map((k) => (
              <li key={k.id} className="flex items-center gap-3 rounded-lg border p-3" data-partner-client={k.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-muted-foreground">{`${people(k.members)} · since ${day(k.createdAt)}`}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
