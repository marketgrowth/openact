import { useEffect, useState, type FormEvent } from "react";
import { Field, Icon, Modal, Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Badge } from "@openact/ui/components/badge";
import { Card } from "@openact/ui/components/card";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { PIN_MAX, PIN_MIN, type LocationInfo, type PersonInfo } from "../shared/rules";
import { companyApi, useCompanyData, useMe } from "./lib";

type Member = { userId: string; name: string; email: string; role: string };

/** People and PINs: who clocks in, where, and with which PIN. */
export default function PeoplePage() {
  const me = useMe();
  const canSetup = !!me.data?.canSetup;
  const people = useCompanyData<{ people: PersonInfo[] }>(canSetup ? "/people" : null);
  const locs = useCompanyData<{ locations: LocationInfo[] }>(canSetup ? "/locations" : null);
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<PersonInfo | "new" | null>(null);
  const [shownPin, setShownPin] = useState<{ name: string; pin: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const companyId = people.companyId;

  useEffect(() => {
    if (canSetup && companyId) api<{ members: Member[] }>(`${companyApi(companyId)}/members`).then((r) => setMembers(r.members), () => setMembers([]));
  }, [canSetup, companyId]);

  const locName = (id: string) => locs.data?.locations.find((l) => l.id === id)?.name ?? "";

  async function newPin(p: PersonInfo) {
    if (!companyId) return;
    setError(null);
    try {
      const r = await api<{ pin: string }>(`${companyApi(companyId)}/people/${p.id}/pin`, { method: "POST", body: {} });
      setShownPin({ name: p.name, pin: r.pin });
      people.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function setActive(p: PersonInfo, isActive: boolean) {
    if (!companyId) return;
    setError(null);
    try {
      await api(`${companyApi(companyId)}/people/${p.id}`, { method: "PATCH", body: { isActive } });
      people.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <SiteHeader title="People and PINs">
        {canSetup && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Icon name="plus" />
            <span className="hidden sm:inline">Add a person</span>
            <span className="sr-only sm:hidden">Add a person</span>
          </Button>
        )}
      </SiteHeader>
      <PageBody>
        {(me.error || people.error || locs.error || error) && <Notice tone="error">{me.error || people.error || locs.error || error}</Notice>}
        {me.data && !canSetup && <Notice tone="info">Your role does not allow this: Set up WorkSpent. Ask a company owner or admin.</Notice>}
        {shownPin && (
          <Notice tone="info">
            The PIN of {shownPin.name} is <strong className="font-mono text-base tracking-widest">{shownPin.pin}</strong>. Give it to them now. WorkSpent does not show it again.
          </Notice>
        )}
        {canSetup && (
          <p className="text-sm text-muted-foreground">
            A person clocks in with a PIN of {PIN_MIN} to {PIN_MAX} digits. They need no account and no email. Link an account when the person also uses OpenAct, so they can see
            their own hours on My time.
          </p>
        )}
        {people.data && people.data.people.length === 0 && <Notice tone="info">Nobody is in WorkSpent yet. Add the first person.</Notice>}
        {people.data && people.data.people.length > 0 && (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Account</TableHead>
                  <TableHead className="hidden sm:table-cell">Locations</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.data.people.map((p) => (
                  <TableRow key={p.id} className={p.isActive ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">
                      {p.name}
                      {!p.isActive && (
                        <Badge variant="outline" className="ml-2">
                          Off
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{p.email ?? <span className="text-muted-foreground">No account</span>}</TableCell>
                    <TableCell className="hidden sm:table-cell">{p.locationIds.map(locName).filter(Boolean).join(", ") || <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell>{p.hasPin ? "Set" : <span className="text-muted-foreground">Not set</span>}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        <Button size="xs" variant="ghost" onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                        {p.isActive && (
                          <Button size="xs" variant="ghost" onClick={() => newPin(p)}>
                            New PIN
                          </Button>
                        )}
                        <Button size="xs" variant="ghost" onClick={() => setActive(p, !p.isActive)}>
                          {p.isActive ? "Turn off" : "Turn on"}
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        {canSetup && (
          <p className="text-xs text-muted-foreground">
            Turn off a person who left. Their hours stay. A person who is off cannot clock in. PINs are stored as a secure hash, so nobody can read a PIN later.
          </p>
        )}
      </PageBody>
      {editing && companyId && (
        <PersonForm
          companyId={companyId}
          person={editing === "new" ? null : editing}
          locations={(locs.data?.locations ?? []).filter((l) => !l.isArchived)}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={(pin, name) => {
            setEditing(null);
            if (pin) setShownPin({ name, pin });
            people.reload();
            locs.reload();
          }}
        />
      )}
    </>
  );
}

function PersonForm({
  companyId,
  person,
  locations,
  members,
  onClose,
  onSaved
}: {
  companyId: string;
  person: PersonInfo | null;
  locations: LocationInfo[];
  members: Member[];
  onClose: () => void;
  onSaved: (pin: string | null, name: string) => void;
}) {
  const [name, setName] = useState(person?.name ?? "");
  const [userId, setUserId] = useState(person?.userId ?? "");
  const [locationIds, setLocationIds] = useState<string[]>(person?.locationIds ?? (locations.length === 1 ? [locations[0]!.id] : []));
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (person) {
        await api(`${companyApi(companyId)}/people/${person.id}`, { method: "PATCH", body: { name, userId: userId || null, locationIds } });
        onSaved(null, name);
      } else {
        const r = await api<{ pin: string }>(`${companyApi(companyId)}/people`, { method: "POST", body: { name, userId: userId || null, locationIds, pin: pin || undefined } });
        onSaved(r.pin, name);
      }
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={person ? `Edit ${person.name}` : "Add a person"} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        <Field label="Name" htmlFor="ws-person-name" help="As it shows on the PIN pad and on the timesheet.">
          <Input id="ws-person-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Locations</legend>
          {locations.length === 0 && <p className="text-sm text-muted-foreground">Add a location first, in Locations and devices.</p>}
          {locations.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={locationIds.includes(l.id)}
                onCheckedChange={(v) => setLocationIds(v ? [...locationIds, l.id] : locationIds.filter((x) => x !== l.id))}
              />
              {l.name}
            </label>
          ))}
        </fieldset>
        <Field label="Account" htmlFor="ws-person-user" help="Optional. Link the person's OpenAct account, so they see their own hours.">
          <NativeSelect id="ws-person-user" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full">
            <NativeSelectOption value="">No account</NativeSelectOption>
            {members.map((m) => (
              <NativeSelectOption key={m.userId} value={m.userId}>
                {m.name} ({m.email})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {!person && (
          <Field label="PIN" htmlFor="ws-person-pin" help={`Optional. ${PIN_MIN} to ${PIN_MAX} digits. Leave it empty and WorkSpent makes one.`}>
            <Input
              id="ws-person-pin"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
              inputMode="numeric"
              autoComplete="off"
              className="w-32 font-mono tracking-widest"
            />
          </Field>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {person ? "Save" : "Add the person"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
