import { useEffect, useState, type FormEvent } from "react";
import { Field, Icon, Notice, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@openact/ui/components/sheet";
import { cn } from "@openact/ui/lib/utils";
import { PUNCH_KINDS, PUNCH_LABELS, durationText, localDate, type ChangeInfo, type PersonDetail, type PunchInfo, type PunchKind } from "../shared/rules";
import { FlagBadges, companyApi, dayText, localParts, periodText, timeText } from "./lib";

/** One person's clock-ins for a pay period, with the manager fixes. Opens from the timesheet. */
export default function PersonSheet({
  companyId,
  locationId,
  personId,
  start,
  onClose,
  onChanged
}: {
  companyId: string;
  locationId: string;
  personId: string;
  start: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [pin, setPin] = useState<string | null>(null);
  const base = companyApi(companyId);

  useEffect(() => {
    api<PersonDetail>(`${base}/locations/${locationId}/people/${personId}?start=${start}`).then(setD, (e) => setError(errorText(e)));
  }, [base, locationId, personId, start, n]);

  const refresh = () => {
    setN((x) => x + 1);
    onChanged();
  };
  const tz = d?.location.timeZone ?? "UTC";
  const locked = d?.status === "approved";
  const canFix = !!d && !locked && !d.person.isSelf;

  const days = new Map<string, PunchInfo[]>();
  for (const p of d?.punches ?? []) {
    const day = localDate(Date.parse(p.at), tz);
    days.set(day, [...(days.get(day) ?? []), p]);
  }

  async function newPin() {
    setError(null);
    try {
      const r = await api<{ pin: string }>(`${base}/people/${personId}/pin`, { method: "POST", body: {} });
      setPin(r.pin);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-workspent-person="">
        <SheetHeader>
          <SheetTitle>{d?.person.name ?? "Loading…"}</SheetTitle>
          <SheetDescription>
            {d ? `${d.location.name} · ${periodText(d.period)} · ${durationText(d.sheet.minutes)}` : "Clock-ins for this pay period"}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-6">
          {error && <Notice tone="error">{error}</Notice>}
          {locked && <Notice tone="info">This pay period is approved. Its hours are locked. A company owner or admin can reopen it.</Notice>}
          {d?.person.isSelf && <Notice tone="info">These are your own hours. Another manager must fix them.</Notice>}
          {d && (
            <p className="text-sm">
              Now:{" "}
              <strong>
                {d.state.state === "out" ? "Clocked out" : d.state.state === "on_break" ? "On meal break" : "On the clock"}
              </strong>
              {d.state.since ? ` since ${timeText(d.state.since, tz)}` : ""}
            </p>
          )}

          {d && days.size === 0 && <p className="text-sm text-muted-foreground">No clock-ins in this pay period.</p>}
          {[...days.entries()].map(([day, punches]) => {
            const shifts = d!.sheet.shifts.filter((s) => s.date === day);
            return (
              <section key={day} className="grid gap-2 rounded-lg border p-3" aria-label={dayText(day)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{dayText(day)}</h3>
                  <span className="text-sm tabular-nums text-muted-foreground">{durationText(shifts.reduce((m, s) => m + s.minutes, 0))}</span>
                </div>
                <FlagBadges flags={shifts.flatMap((s) => s.flags)} />
                <ul className="grid gap-2">
                  {punches.map((p) => (
                    <PunchLine
                      key={p.id}
                      punch={p}
                      tz={tz}
                      changes={d!.changes.filter((c) => c.punchId === p.id)}
                      canFix={canFix && !p.isDeleted}
                      base={base}
                      onDone={refresh}
                    />
                  ))}
                </ul>
              </section>
            );
          })}

          {canFix && d && (
            <>
              <AddPunch base={base} locationId={locationId} personId={personId} tz={tz} state={d.state.state} onDone={refresh} />
              <AddShift base={base} locationId={locationId} personId={personId} onDone={refresh} />
            </>
          )}

          {d && !d.person.isSelf && (
            <section className="grid gap-2 rounded-lg border p-3">
              <h3 className="text-sm font-medium">PIN</h3>
              <p className="text-sm text-muted-foreground">Give the person a new PIN when they forget it. The old PIN stops working.</p>
              {pin ? (
                <Notice tone="info">
                  The new PIN is <strong className="font-mono text-base tracking-widest">{pin}</strong>. Give it to {d.person.name} now. WorkSpent does not show it again.
                </Notice>
              ) : (
                <div>
                  <Button variant="outline" size="sm" onClick={newPin}>
                    <Icon name="shield" />
                    Make a new PIN
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PunchLine({ punch, tz, changes, canFix, base, onDone }: { punch: PunchInfo; tz: string; changes: ChangeInfo[]; canFix: boolean; base: string; onDone: () => void }) {
  const [mode, setMode] = useState<"none" | "change" | "delete">("none");
  const [date, setDate] = useState(() => localParts(punch.at, tz).date);
  const [time, setTime] = useState(() => localParts(punch.at, tz).time);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "change") await api(`${base}/punches/${punch.id}`, { method: "PATCH", body: { date, time, reason } });
      else await api(`${base}/punches/${punch.id}`, { method: "DELETE", body: { reason } });
      setMode("none");
      setReason("");
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const source =
    punch.source === "manager" ? "Added by a manager" : punch.deviceName ? `${punch.deviceName}${punch.source === "device" ? " · PIN" : ""}` : punch.source;
  return (
    <li className="grid gap-1 text-sm" data-punch={punch.kind}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("font-medium", punch.isDeleted && "text-muted-foreground line-through")}>
          {PUNCH_LABELS[punch.kind]}, {timeText(punch.at, tz)}
        </span>
        <span className="text-xs text-muted-foreground">
          {source}
          {punch.isLateSync ? " · sent late" : ""}
        </span>
        {canFix && mode === "none" && (
          <span className="ml-auto flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => setMode("change")}>
              Change
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setMode("delete")}>
              Delete
            </Button>
          </span>
        )}
      </div>
      {changes.map((c) => (
        <p key={c.id} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {c.action === "add" ? "Added" : c.action === "delete" ? "Deleted" : `Changed from ${timeText(c.oldAt, tz)}`} by {c.changedBy ?? "a manager"}. Why: {c.reason}
          {c.response === "confirmed" && " · The person confirmed it."}
          {c.response === "questioned" && ` · The person questioned it${c.responseNote ? `: ${c.responseNote}` : "."}`}
        </p>
      ))}
      {mode !== "none" && (
        <form onSubmit={save} className="grid gap-2 rounded-md border p-2">
          {mode === "change" && (
            <div className="flex flex-wrap gap-2">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="w-auto" required />
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="w-auto" required />
            </div>
          )}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (required)" aria-label="Why" maxLength={300} required />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={mode === "delete" ? "destructive" : "default"} disabled={busy || !reason.trim()}>
              {mode === "delete" ? "Delete it" : "Save the fix"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function AddPunch({ base, locationId, personId, tz, state, onDone }: { base: string; locationId: string; personId: string; tz: string; state: string; onDone: () => void }) {
  const now = localParts(new Date().toISOString(), tz);
  const [kind, setKind] = useState<PunchKind>(state === "out" ? "in" : "out");
  const [when, setWhen] = useState<"now" | "earlier">("earlier");
  const [date, setDate] = useState(now.date);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/locations/${locationId}/punches`, { method: "POST", body: { personId, kind, reason, ...(when === "now" ? {} : { date, time }) } });
      setReason("");
      setTime("");
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-lg border p-3" aria-label="Add a missed clock-in or clock-out">
      <h3 className="text-sm font-medium">Add a missed clock-in, clock-out or break</h3>
      <div className="flex flex-wrap gap-2">
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as PunchKind)} aria-label="What">
          {PUNCH_KINDS.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {PUNCH_LABELS[k]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect value={when} onChange={(e) => setWhen(e.target.value as "now" | "earlier")} aria-label="When">
          <NativeSelectOption value="earlier">At a time</NativeSelectOption>
          <NativeSelectOption value="now">Now</NativeSelectOption>
        </NativeSelect>
        {when === "earlier" && (
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="w-auto" required />
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="w-auto" required />
          </>
        )}
      </div>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (required)" aria-label="Why" maxLength={300} required />
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <Button type="submit" size="sm" disabled={busy || !reason.trim()}>
          Save the fix
        </Button>
      </div>
    </form>
  );
}

function AddShift({ base, locationId, personId, onDone }: { base: string; locationId: string; personId: string; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [inTime, setIn] = useState("");
  const [outTime, setOut] = useState("");
  const [breakStart, setBs] = useState("");
  const [breakEnd, setBe] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const brk = breakStart && breakEnd ? { breakStart, breakEnd } : {};
      await api(`${base}/locations/${locationId}/shifts`, { method: "POST", body: { personId, date, inTime, outTime, reason, ...brk } });
      setReason("");
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-lg border p-3" aria-label="Add a whole shift">
      <h3 className="text-sm font-medium">Add a whole shift</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="ws-shift-date">
          <Input id="ws-shift-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Clock in" htmlFor="ws-shift-in">
          <Input id="ws-shift-in" type="time" value={inTime} onChange={(e) => setIn(e.target.value)} required />
        </Field>
        <Field label="Clock out" htmlFor="ws-shift-out">
          <Input id="ws-shift-out" type="time" value={outTime} onChange={(e) => setOut(e.target.value)} required />
        </Field>
        <Field label="Meal break start" htmlFor="ws-shift-bs" help="Optional">
          <Input id="ws-shift-bs" type="time" value={breakStart} onChange={(e) => setBs(e.target.value)} />
        </Field>
        <Field label="Meal break end" htmlFor="ws-shift-be">
          <Input id="ws-shift-be" type="time" value={breakEnd} onChange={(e) => setBe(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">A clock-out time before the clock-in time is on the next day.</p>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (required)" aria-label="Why" maxLength={300} required />
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <Button type="submit" size="sm" disabled={busy || !reason.trim()}>
          Add the shift
        </Button>
      </div>
    </form>
  );
}
