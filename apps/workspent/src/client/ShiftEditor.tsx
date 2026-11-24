import { useState, type FormEvent } from "react";
import { Field, Notice, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@openact/ui/components/sheet";
import { cn } from "@openact/ui/lib/utils";
import { durationText, hoursText, wallClock } from "../shared/rules";
import { BREAK_CHOICES, MAX_REPEAT_WEEKS, hoursShort, QUICK_TIMES, STATUS_LABELS, overlaps, shiftTimes, weekMinutes, type ScheduleData, type ShiftInfo } from "../shared/schedule";
import { companyApi, dayText } from "./lib";

export type EditTarget = { shift: ShiftInfo } | { personId: string | null; date: string };

/** Adds or changes one shift. Shows the person's week hours and refuses overlaps before it saves. */
export default function ShiftEditor({ companyId, data, target, onClose, onSaved }: { companyId: string; data: ScheduleData; target: EditTarget; onClose: () => void; onSaved: () => void }) {
  const tz = data.location.timeZone;
  const shift = "shift" in target ? target.shift : null;
  const start = shift ? wallClock(Date.parse(shift.startsAt), tz) : null;
  const end = shift ? wallClock(Date.parse(shift.endsAt), tz) : null;
  const [personId, setPerson] = useState<string>(shift ? (shift.personId ?? "") : ("personId" in target ? (target.personId ?? "") : ""));
  const [date, setDate] = useState(shift ? start!.date : "date" in target ? target.date : data.today);
  const [startTime, setStart] = useState(start?.time ?? QUICK_TIMES[0]!.start);
  const [endTime, setEnd] = useState(end?.time ?? QUICK_TIMES[0]!.end);
  const [breakMinutes, setBreak] = useState(shift?.breakMinutes ?? 30);
  const [repeatWeeks, setRepeat] = useState(0);
  const [note, setNote] = useState(shift?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = companyApi(companyId);
  const deleted = shift?.status === "deleted";
  const people = data.people.filter((p) => p.isActive || p.id === personId);

  // A preview of the times, the hours and any clash, before saving.
  const t = date && startTime && endTime ? shiftTimes(date, startTime, endTime, tz) : null;
  const ok = t && !("problem" in t) ? t : null;
  const length = ok ? (Date.parse(ok.endsAt) - Date.parse(ok.startsAt)) / 60_000 : 0;
  const clash = ok && personId ? data.shifts.find((s) => s.id !== shift?.id && s.personId === personId && s.status !== "deleted" && overlaps(s, ok)) : null;
  const others = data.shifts.filter((s) => s.id !== shift?.id);
  const week = personId && ok ? (weekMinutes(others, date, tz).get(personId) ?? 0) + Math.max(0, length - breakMinutes) : 0;
  const over = week > data.weekLimitMinutes;
  const name = data.people.find((p) => p.id === personId)?.name ?? "";

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { personId: personId || null, date, startTime, endTime, breakMinutes, note };
      if (shift) await api(`${base}/schedule/${shift.id}`, { method: "PATCH", body });
      else await api(`${base}/locations/${data.location.id}/schedule`, { method: "POST", body: { ...body, repeatWeeks } });
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!shift) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/schedule/${shift.id}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-shift-editor="">
        <SheetHeader>
          <SheetTitle>{shift ? (shift.personId ? "Edit shift" : "Fill an open shift") : "Add a shift"}</SheetTitle>
          <SheetDescription>
            {data.location.name}
            {shift ? ` · ${STATUS_LABELS[shift.status]}` : " · Saved as a draft until you publish"}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={save} className="grid gap-4 px-4 pb-6">
          {deleted && <Notice tone="info">This shift is deleted. Staff still see it until you publish the change.</Notice>}
          <Field label="Person" htmlFor="ws-shift-person">
            <NativeSelect id="ws-shift-person" value={personId} onChange={(e) => setPerson(e.target.value)} className="w-full" disabled={deleted}>
              <NativeSelectOption value="">Open shift (nobody yet)</NativeSelectOption>
              {people.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="ws-shift-day">
              <Input id="ws-shift-day" type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={deleted} />
            </Field>
            <Field label="Meal break" htmlFor="ws-shift-break">
              <NativeSelect id="ws-shift-break" value={String(breakMinutes)} onChange={(e) => setBreak(Number(e.target.value))} className="w-full" disabled={deleted}>
                {[...new Set([...BREAK_CHOICES, breakMinutes])].map((m) => (
                  <NativeSelectOption key={m} value={String(m)}>
                    {m ? `${m} min` : "None"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Start" htmlFor="ws-shift-start">
              <Input id="ws-shift-start" type="time" value={startTime} onChange={(e) => setStart(e.target.value)} required disabled={deleted} />
            </Field>
            <Field label="End" htmlFor="ws-shift-end">
              <Input id="ws-shift-end" type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} required disabled={deleted} />
            </Field>
          </div>
          {!deleted && (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Quick times</span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TIMES.map((q) => (
                  <Button
                    key={q.band}
                    type="button"
                    size="sm"
                    variant="outline"
                    className={cn("rounded-full", startTime === q.start && endTime === q.end && "bg-accent")}
                    onClick={() => {
                      setStart(q.start);
                      setEnd(q.end);
                    }}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {!shift && (
            <Field label="Repeat" htmlFor="ws-shift-repeat">
              <NativeSelect id="ws-shift-repeat" value={String(repeatWeeks)} onChange={(e) => setRepeat(Number(e.target.value))} className="w-full">
                <NativeSelectOption value="0">Does not repeat</NativeSelectOption>
                {[3, 7, MAX_REPEAT_WEEKS - 1].map((n) => (
                  <NativeSelectOption key={n} value={String(n)}>
                    Every week, for {n + 1} weeks
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Note for the person" htmlFor="ws-shift-note" help="Optional. The person sees it on My time.">
            <Input id="ws-shift-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} disabled={deleted} />
          </Field>

          {t && "problem" in t && <Notice tone="error">{t.problem}</Notice>}
          {ok && (
            <p className="text-sm text-muted-foreground">
              {dayText(date)}: {durationText(length)} shift
              {breakMinutes ? `, ${breakMinutes} min meal break` : ""}. {durationText(Math.max(0, length - breakMinutes))} scheduled.
              {wallClock(Date.parse(ok.endsAt), tz).date !== date ? " It ends the next day." : ""}
            </p>
          )}
          {clash && <Notice tone="error">{name} already has a shift at that time. Change the times or pick another person.</Notice>}
          {over && !clash && (
            <Notice tone="info">
              {name} is scheduled {hoursShort(week)} hours in this week. That is over the {hoursShort(data.weekLimitMinutes)} hour flag at this location.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}

          {!deleted && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !ok || !!clash}>
                {shift ? "Save the shift" : repeatWeeks ? `Add ${repeatWeeks + 1} shifts` : "Add the shift"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {shift && (
                <Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">A saved shift is a draft. Staff see it on My time after you publish. A person cannot have two shifts at the same time.</p>
        </form>
      </SheetContent>
    </Sheet>
  );
}
