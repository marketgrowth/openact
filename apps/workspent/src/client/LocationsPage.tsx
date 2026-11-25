import { useEffect, useState, type FormEvent } from "react";
import { Field, Icon, Modal, Notice, PageBody, SiteHeader, api, errorText, navigate } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Badge } from "@openact/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import {
  CLOCK_PATH,
  DEFAULT_LIMITS,
  DEVICE_STORAGE,
  LIMIT_RANGES,
  PERIOD_KINDS,
  PERIOD_LABELS,
  PIN_LOCK_MS,
  PIN_TRIES,
  type DeviceInfo,
  type DeviceKind,
  type FlagLimits,
  type LocationInfo,
  type PeriodKind
} from "../shared/rules";
import { companyApi, useCompanyData, useMe, zoneName, timeZones } from "./lib";

type Member = { userId: string; name: string; email: string; role: string };

/** Locations and devices: each location's rules, managers and time clock devices. */
export default function LocationsPage() {
  const me = useMe();
  const locs = useCompanyData<{ locations: LocationInfo[] }>(me.data?.canSetup || me.data?.managedLocationIds.length || me.data?.canManageAll ? "/locations" : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = locs.data?.locations ?? [];
  const current = list.find((l) => l.id === selected) ?? list.find((l) => !l.isArchived) ?? null;
  const canSetup = !!me.data?.canSetup;

  return (
    <>
      <SiteHeader title="Locations and devices">
        {canSetup && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            <span className="hidden sm:inline">Add a location</span>
            <span className="sr-only sm:hidden">Add a location</span>
          </Button>
        )}
      </SiteHeader>
      <PageBody>
        {(me.error || locs.error) && <Notice tone="error">{me.error || locs.error}</Notice>}
        {me.data && !canSetup && !me.data.canManageAll && !me.data.managedLocationIds.length && (
          <Notice tone="info">Your role does not allow this: Set up WorkSpent. Ask a company owner or admin.</Notice>
        )}
        <p className="text-sm text-muted-foreground">
          Each location has a clock-in rule. On site: people clock in at the location with a PIN, on a time clock device.
        </p>
        {locs.data && list.length === 0 && (
          <Notice tone="info">{canSetup ? "Add your first location, such as a care home or an office." : "There is no location yet."}</Notice>
        )}
        {list.length > 0 && (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead className="hidden sm:table-cell">Clock-in rule</TableHead>
                  <TableHead className="text-right">Devices</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead className="hidden md:table-cell">Time zone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((l) => (
                  <TableRow key={l.id} data-state={current?.id === l.id ? "selected" : undefined}>
                    <TableCell>
                      <button type="button" className="text-left font-medium underline-offset-4 hover:underline" onClick={() => setSelected(l.id)}>
                        {l.name}
                      </button>
                      {l.isArchived && (
                        <Badge variant="outline" className="ml-2">
                          Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">On site</TableCell>
                    <TableCell className="text-right tabular-nums">{l.deviceCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.peopleCount}</TableCell>
                    <TableCell className="hidden md:table-cell">{zoneName(l.timeZone)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        {current && locs.companyId && (
          <LocationEditor key={current.id} companyId={locs.companyId} location={current} canSetup={canSetup} onChanged={locs.reload} />
        )}
        <p className="text-xs text-muted-foreground">
          PINs have 4 to 6 digits. Set them on each person in People and PINs. {PIN_TRIES} wrong PINs in a row lock the PIN pad of a device for{" "}
          {PIN_LOCK_MS / 60_000} minutes. A manager can unlock it here.
        </p>
      </PageBody>
      {adding && locs.companyId && (
        <AddLocation
          companyId={locs.companyId}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setSelected(id);
            locs.reload();
          }}
        />
      )}
    </>
  );
}

function sundayOfThisWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()));
  return d.toISOString().slice(0, 10);
}

function AddLocation({ companyId, onClose, onAdded }: { companyId: string; onClose: () => void; onAdded: (id: string) => void }) {
  const [name, setName] = useState("");
  const [timeZone, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [periodKind, setKind] = useState<PeriodKind>("biweekly");
  const [periodStartDate, setStart] = useState(sundayOfThisWeek);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = timeZones();

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ location: LocationInfo }>(`${companyApi(companyId)}/locations`, { method: "POST", body: { name, timeZone, periodKind, periodStartDate } });
      onAdded(r.location.id);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a location" description="A place or a team that hours belong to, such as a care home." onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        <Field label="Name" htmlFor="ws-loc-name">
          <Input id="ws-loc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
        </Field>
        <Field label="Time zone" htmlFor="ws-loc-tz" help="Clock-in times show in this time zone.">
          <NativeSelect id="ws-loc-tz" value={timeZone} onChange={(e) => setTz(e.target.value)} className="w-full">
            {zones.map((z) => (
              <NativeSelectOption key={z} value={z}>
                {z}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <PeriodFields kind={periodKind} start={periodStartDate} onKind={setKind} onStart={setStart} />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            Add the location
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PeriodFields({ kind, start, onKind, onStart }: { kind: PeriodKind; start: string; onKind: (k: PeriodKind) => void; onStart: (d: string) => void }) {
  return (
    <>
      <Field label="Pay period" htmlFor="ws-loc-period">
        <NativeSelect id="ws-loc-period" value={kind} onChange={(e) => onKind(e.target.value as PeriodKind)} className="w-full">
          {PERIOD_KINDS.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {PERIOD_LABELS[k]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {kind !== "semimonthly" && (
        <Field label="First day of a pay period" htmlFor="ws-loc-start" help="Any first day of a pay period, past or future. The periods repeat from it.">
          <Input id="ws-loc-start" type="date" value={start} onChange={(e) => onStart(e.target.value)} required />
        </Field>
      )}
    </>
  );
}

function LocationEditor({ companyId, location, canSetup, onChanged }: { companyId: string; location: LocationInfo; canSetup: boolean; onChanged: () => void }) {
  const base = companyApi(companyId);
  const [name, setName] = useState(location.name);
  const [periodKind, setKind] = useState(location.periodKind);
  const [periodStartDate, setStart] = useState(location.periodStartDate);
  const [limits, setLimits] = useState<FlagLimits>(location.limits);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [managerIds, setManagerIds] = useState<string[]>(location.managerIds);
  const [n, setN] = useState(0);
  const [setup, setSetup] = useState(false);

  useEffect(() => {
    api<{ devices: DeviceInfo[] }>(`${base}/locations/${location.id}/devices`).then((r) => setDevices(r.devices), (e) => setError(errorText(e)));
  }, [base, location.id, n]);
  useEffect(() => {
    if (canSetup) api<{ members: Member[] }>(`${base}/members`).then((r) => setMembers(r.members), () => setMembers([]));
  }, [base, canSetup]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api(`${base}/locations/${location.id}`, { method: "PATCH", body: { name, periodKind, periodStartDate, limits } });
      await api(`${base}/locations/${location.id}/managers`, { method: "PUT", body: { userIds: managerIds } });
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function act(path: string) {
    setError(null);
    try {
      await api(`${base}${path}`, { method: "POST" });
      setN((x) => x + 1);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function archive(isArchived: boolean) {
    setError(null);
    try {
      await api(`${base}/locations/${location.id}`, { method: "PATCH", body: { isArchived } });
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Card data-workspent-location="">
      <CardHeader>
        <CardTitle>{location.name}</CardTitle>
        <CardDescription>
          Clock-in rule: on site. People type a PIN on this location's time clock devices. Time zone: {zoneName(location.timeZone)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {error && <Notice tone="error">{error}</Notice>}
        {canSetup && (
          <form onSubmit={save} className="grid gap-4">
            <div className="grid items-start gap-4 md:grid-cols-2">
              <Field label="Name" htmlFor="ws-edit-name">
                <Input id="ws-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              </Field>
              <div className="grid gap-4">
                <PeriodFields kind={periodKind} start={periodStartDate} onKind={setKind} onStart={setStart} />
              </div>
            </div>
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-medium">Flags on the timesheet</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <LimitField label="More than this many hours in a day" value={limits.dayHours} k="dayHours" onChange={(v) => setLimits({ ...limits, dayHours: v })} />
                <LimitField label="More than this many hours in a week" value={limits.weekHours} k="weekHours" onChange={(v) => setLimits({ ...limits, weekHours: v })} />
                <LimitField label="No meal break after this many hours" value={limits.mealAfterHours} k="mealAfterHours" onChange={(v) => setLimits({ ...limits, mealAfterHours: v })} />
                <LimitField label="Missed clock-out after this many hours" value={limits.missedOutHours} k="missedOutHours" onChange={(v) => setLimits({ ...limits, missedOutHours: v })} />
              </div>
              <p className="text-xs text-muted-foreground">
                Flags help managers check the hours. They do not change pay. Defaults: {DEFAULT_LIMITS.dayHours} a day, {DEFAULT_LIMITS.weekHours} a week, a meal break by{" "}
                {DEFAULT_LIMITS.mealAfterHours} hours, a missed clock-out after {DEFAULT_LIMITS.missedOutHours} hours.
              </p>
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Location managers</legend>
              <p className="text-xs text-muted-foreground">They see this location's timesheets, fix clock-ins and approve its pay periods.</p>
              {members === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {members
                    .filter((m) => m.role !== "guest")
                    .map((m) => (
                      <label key={m.userId} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={managerIds.includes(m.userId)}
                          onCheckedChange={(v) => setManagerIds(v ? [...managerIds, m.userId] : managerIds.filter((x) => x !== m.userId))}
                        />
                        <span>
                          {m.name} <span className="text-muted-foreground">({m.email})</span>
                        </span>
                      </label>
                    ))}
                </div>
              )}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit">Save the location</Button>
              {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
              <Button type="button" variant="ghost" className="ml-auto" onClick={() => archive(!location.isArchived)}>
                <Icon name={location.isArchived ? "unarchive" : "archive"} />
                {location.isArchived ? "Bring back the location" : "Archive the location"}
              </Button>
            </div>
          </form>
        )}

        <section className="grid gap-3" aria-label="Time clock devices">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Time clock devices</h3>
              <p className="text-xs text-muted-foreground">A tablet or a computer at the location. It shows the PIN pad and reports in every few minutes.</p>
            </div>
            {canSetup && !location.isArchived && (
              <Button variant="outline" size="sm" onClick={() => setSetup(true)}>
                <Icon name="monitor" />
                Set up this device as the time clock
              </Button>
            )}
          </div>
          {devices && devices.length === 0 && <p className="text-sm text-muted-foreground">No time clock device yet.</p>}
          {devices && devices.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead className="hidden sm:table-cell">Kind</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="hidden md:table-cell">Internet address</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.name}
                      {!d.isActive && (
                        <Badge variant="outline" className="ml-2">
                          Off
                        </Badge>
                      )}
                      {d.lockedUntil && (
                        <Badge variant="outline" className="ml-2 border-warn-border bg-warn text-warn-foreground">
                          PIN pad locked
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden capitalize sm:table-cell">{d.kind}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        {d.isActive && <span className={d.online ? "size-2 rounded-full bg-live" : "size-2 rounded-full bg-muted-foreground/40"} aria-hidden="true" />}
                        {d.lastSeenAt ? agoText(d.lastSeenAt) : "Never"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{d.lastIpAddress ?? ""}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex gap-1">
                        {d.lockedUntil && (
                          <Button size="xs" variant="outline" onClick={() => act(`/devices/${d.id}/unlock`)}>
                            Unlock
                          </Button>
                        )}
                        {canSetup && d.isActive && (
                          <Button size="xs" variant="ghost" onClick={() => act(`/devices/${d.id}/off`)}>
                            Switch off
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </CardContent>
      {setup && <SetupDevice companyId={companyId} location={location} onClose={() => setSetup(false)} />}
    </Card>
  );
}

function LimitField({ label, value, k, onChange }: { label: string; value: number; k: keyof FlagLimits; onChange: (v: number) => void }) {
  const r = LIMIT_RANGES[k];
  return (
    <Field label={label} htmlFor={`ws-limit-${k}`}>
      <Input
        id={`ws-limit-${k}`}
        type="number"
        inputMode="decimal"
        min={r.min}
        max={r.max}
        step={0.25}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28"
        required
      />
    </Field>
  );
}

function agoText(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Makes this browser the time clock of a location. The device key stays in this browser only. */
function SetupDevice({ companyId, location, onClose }: { companyId: string; location: LocationInfo; onClose: () => void }) {
  const [name, setName] = useState("Front office tablet");
  const [kind, setKind] = useState<DeviceKind>("tablet");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: string }>(`${companyApi(companyId)}/locations/${location.id}/devices`, { method: "POST", body: { name, kind } });
      try {
        localStorage.setItem(DEVICE_STORAGE, r.key);
      } catch {
        setError("This browser does not keep data, so it cannot be a time clock. Turn off private browsing and try again.");
        setBusy(false);
        return;
      }
      navigate(CLOCK_PATH);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Set up this device as the time clock" description={`This browser becomes the time clock of ${location.name}.`} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        <Notice tone="info">
          Do this on the tablet or computer that stays at the location. The device then shows only the PIN pad. You can sign out after the setup. To stop the device,
          choose Switch off here.
        </Notice>
        <Field label="Device name" htmlFor="ws-dev-name">
          <Input id="ws-dev-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </Field>
        <Field label="Kind" htmlFor="ws-dev-kind">
          <NativeSelect id="ws-dev-kind" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)} className="w-full">
            <NativeSelectOption value="tablet">Tablet</NativeSelectOption>
            <NativeSelectOption value="computer">Computer</NativeSelectOption>
          </NativeSelect>
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            Set up and open the PIN pad
          </Button>
        </div>
      </form>
    </Modal>
  );
}
