import { useState } from "react";
import { Button } from "@openact/ui/components/button";
import { Badge } from "@openact/ui/components/badge";
import { cn } from "@openact/ui/lib/utils";
import { addDays, durationText, hoursText, zonedToUtc } from "../shared/rules";
import {
  BAND_LABELS,
  BANDS,
  arrival,
  bandOf,
  coverage,
  datesBetween,
  hourly,
  hoursShort,
  scheduledMinutes,
  shiftDate,
  weekMinutes,
  type ScheduleData,
  type ShiftInfo
} from "../shared/schedule";
import { dayText, timeText } from "./lib";
import { BAND_BAR, BAND_DOT, ShiftChip, initials, rangeText } from "./schedule-parts";

/* The four schedule views: Week (roster), Day (timeline against the time clock), Month (calendar) and List. */

type Edit = (shift: ShiftInfo) => void;
type Add = (personId: string | null, date: string) => void;

const shiftsOn = (shifts: ShiftInfo[], date: string, tz: string, personId: string | null | undefined) =>
  shifts.filter((s) => shiftDate(s.startsAt, tz) === date && (personId === undefined || s.personId === personId)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

const dow = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(date + "T00:00:00Z"));
const dayNum = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(date + "T00:00:00Z"));

/* Week ---------------------------------------------------------------- */

export function WeekView({ data, from, onAdd, onEdit }: { data: ScheduleData; from: string; onAdd: Add; onEdit: Edit }) {
  const tz = data.location.timeZone;
  const dates = datesBetween(from, addDays(from, 6));
  const totals = weekMinutes(data.shifts, from, tz);
  const cover = coverage(data.shifts, dates, tz);
  const limit = data.weekLimitMinutes;
  const cols = "grid grid-cols-[minmax(170px,200px)_repeat(7,minmax(0,1fr))]";
  return (
    <div className="overflow-x-auto rounded-lg border" data-schedule-view="week">
      <div className="min-w-[920px]">
        <div className={cn(cols, "border-b bg-muted/40")}>
          <div className="px-3 py-2 text-xs text-muted-foreground">Person · week hours</div>
          {dates.map((d) => (
            <div key={d} className={cn("border-l px-3 py-2", d === data.today && "bg-accent shadow-[inset_0_-2px_0_var(--color-today)]")}>
              <div className="text-xs text-muted-foreground">
                {dow(d)}
                {d === data.today ? " · Today" : ""}
              </div>
              <div className="text-sm font-semibold tabular-nums">{dayNum(d)}</div>
            </div>
          ))}
        </div>

        <div className={cn(cols, "border-b bg-warn/40")}>
          <div className="flex flex-col justify-center px-3 py-2">
            <span className="text-sm font-semibold text-warn-foreground">Open shifts</span>
            <span className="text-xs text-muted-foreground">Nobody assigned yet</span>
          </div>
          {dates.map((d) => (
            <div key={d} className="group flex min-h-14 flex-col gap-1 border-l p-1.5">
              {shiftsOn(data.shifts, d, tz, null).map((s) => (
                <ShiftChip key={s.id} shift={s} tz={tz} onClick={() => onEdit(s)} />
              ))}
              <button
                type="button"
                onClick={() => onAdd(null, d)}
                aria-label={`Add an open shift on ${dayText(d)}`}
                className="mt-auto rounded-md py-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100"
              >
                + Open shift
              </button>
            </div>
          ))}
        </div>

        {data.people.map((p) => {
          const mins = totals.get(p.id) ?? 0;
          const over = mins > limit;
          return (
            <div key={p.id} className={cn(cols, "border-b")} data-person={p.id}>
              <div className="flex flex-col justify-center gap-1.5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold" aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  <span className={cn("truncate text-sm font-medium", !p.isActive && "text-muted-foreground line-through")}>{p.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className={cn("h-full rounded-full", over ? "bg-warn-foreground" : "bg-shift-day")} style={{ width: `${Math.min(100, Math.round((mins / Math.max(limit * 1.2, 1)) * 100))}%` }} />
                  </div>
                  <span className={cn("text-xs tabular-nums", over ? "font-semibold text-warn-foreground" : "text-muted-foreground")}>{hoursShort(mins)} h</span>
                </div>
              </div>
              {dates.map((d) => {
                const list = shiftsOn(data.shifts, d, tz, p.id);
                return (
                  <div key={d} className={cn("group flex min-h-16 flex-col justify-center gap-1 border-l p-1.5", d === data.today && "bg-accent/40")}>
                    {list.map((s) => (
                      <ShiftChip key={s.id} shift={s} tz={tz} onClick={() => onEdit(s)} />
                    ))}
                    <button
                      type="button"
                      onClick={() => onAdd(p.id, d)}
                      aria-label={`Add a shift for ${p.name} on ${dayText(d)}`}
                      className={cn(
                        "rounded-md border border-dashed text-muted-foreground transition-opacity hover:bg-accent focus-visible:opacity-100",
                        list.length ? "py-0.5 text-xs opacity-0 group-hover:opacity-100" : "min-h-11 text-lg opacity-40 group-hover:opacity-100"
                      )}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className={cn(cols, "bg-muted/40")}>
          <div className="px-3 py-2">
            <div className="text-xs font-semibold">Coverage</div>
            <div className="text-xs text-muted-foreground">Shifts by part of the day</div>
          </div>
          {cover.map((c) => (
            <div key={c.date} className="flex flex-col gap-1 border-l p-1.5 text-xs">
              {BANDS.map((b) => {
                const gap = c.gaps.includes(b);
                return (
                  <div key={b} className={cn("flex items-center justify-between rounded px-1.5 py-0.5", gap ? "bg-warn font-semibold text-warn-foreground" : "text-muted-foreground")}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", BAND_DOT[b])} aria-hidden="true" />
                      {BAND_LABELS[b]}
                    </span>
                    <span className="tabular-nums">{gap ? "Gap" : c.counts[b] || "None"}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Day ----------------------------------------------------------------- */

export function DayView({ data, date, onAdd, onEdit }: { data: ScheduleData; date: string; onAdd: Add; onEdit: Edit }) {
  const tz = data.location.timeZone;
  const ds = zonedToUtc(date, "00:00", tz);
  const de = zonedToUtc(addDays(date, 1), "00:00", tz);
  const span = de - ds;
  const now = Date.parse(data.now);
  const pct = (ms: number) => `${((Math.min(Math.max(ms, ds), de) - ds) / span) * 100}%`;
  const width = (a: number, b: number) => `${((Math.min(b, de) - Math.max(a, ds)) / span) * 100}%`;
  const touches = (a: string, b: string) => Date.parse(a) < de && Date.parse(b) > ds;
  const live = data.shifts.filter((s) => s.status !== "deleted");
  const ids = new Set<string>();
  for (const s of live) if (s.personId && touches(s.startsAt, s.endsAt)) ids.add(s.personId);
  for (const w of data.worked) if (w.inAt && touches(w.inAt, w.outAt ?? data.now)) ids.add(w.personId);
  const people = data.people.filter((p) => ids.has(p.id));
  const open = live.filter((s) => !s.personId && shiftDate(s.startsAt, tz) === date);
  const hours = hourly(data.shifts, date, tz);
  const max = Math.max(1, ...hours);
  const showNow = now >= ds && now < de;
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const tickText = (h: number) => (h % 24 === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`);
  const cols = "grid grid-cols-[minmax(150px,200px)_minmax(0,1fr)_minmax(130px,170px)]";

  return (
    <div className="flex flex-col gap-4" data-schedule-view="day">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm border border-shift-day/60 bg-shift-day/20" aria-hidden="true" />
          Scheduled
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-live" aria-hidden="true" />
          Clocked in, from the time clock
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-warn-foreground" aria-hidden="true" />
          Not on the schedule
        </span>
        {showNow && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-0.5 bg-today" aria-hidden="true" />
            Now
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <div className="min-w-[900px]">
          <div className={cn(cols, "border-b bg-muted/40")}>
            <div className="px-3 py-2 text-xs text-muted-foreground">Person</div>
            <div className="relative h-9">
              {ticks.map((h, i) => (
                <span
                  key={h}
                  className="absolute top-2.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                  style={{ left: `${(h / 24) * 100}%`, transform: i === 0 ? "translateX(4px)" : i === ticks.length - 1 ? "translateX(calc(-100% - 4px))" : "translateX(-50%)" }}
                >
                  {tickText(h)}
                </span>
              ))}
            </div>
            <div className="border-l px-3 py-2 text-xs text-muted-foreground">Status</div>
          </div>

          {people.length === 0 && open.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nobody is scheduled on {dayText(date)}.</p>}

          {people.map((p) => {
            const mine = live.filter((s) => s.personId === p.id && touches(s.startsAt, s.endsAt));
            const worked = data.worked.filter((w) => w.personId === p.id && w.inAt && touches(w.inAt, w.outAt ?? data.now));
            const todays = mine.find((s) => shiftDate(s.startsAt, tz) === date);
            const ins = data.clockIns.filter((c) => c.personId === p.id).map((c) => c.at);
            const st = todays ? arrival(todays, ins, now) : null;
            const status = !mine.length
              ? { text: "Not on the schedule", cls: "bg-warn text-warn-foreground" }
              : !st
                ? { text: "Shift from the day before", cls: "bg-muted text-muted-foreground" }
                : st.kind === "upcoming"
                  ? { text: `Starts in ${durationText(st.minutes)}`, cls: "bg-muted text-muted-foreground" }
                  : st.kind === "on_time"
                    ? { text: `On time · in ${timeText(ins.find((t) => Math.abs(Date.parse(t) - Date.parse(todays!.startsAt)) < 2 * 3_600_000) ?? null, tz)}`, cls: "bg-accent text-accent-foreground" }
                    : st.kind === "late"
                      ? { text: `Late ${durationText(st.minutes)}`, cls: "bg-warn text-warn-foreground" }
                      : st.kind === "not_in"
                        ? { text: "Not in yet", cls: "bg-warn text-warn-foreground" }
                        : { text: "Done", cls: "bg-muted text-muted-foreground" };
            return (
              <div key={p.id} className={cn(cols, "border-b")} data-person={p.id}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold" aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{mine.length ? mine.map((s) => rangeText(s, tz)).join(", ") : "No shift"}</div>
                  </div>
                </div>
                <div className="relative h-16 bg-[repeating-linear-gradient(to_right,var(--color-border)_0,var(--color-border)_1px,transparent_1px,transparent_12.5%)]">
                  {mine.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onEdit(s)}
                      className={cn(
                        "absolute top-2 flex h-7 items-center overflow-hidden rounded-md border px-2 text-left text-[11px] font-semibold whitespace-nowrap text-foreground hover:brightness-95",
                        BAND_BAR[bandOf(s.startsAt, tz)],
                        s.status !== "published" && "border-dashed"
                      )}
                      style={{ left: pct(Date.parse(s.startsAt)), width: width(Date.parse(s.startsAt), Date.parse(s.endsAt)) }}
                      title={rangeText(s, tz)}
                    >
                      {rangeText(s, tz)}
                    </button>
                  ))}
                  {worked.map((w, i) => (
                    <div
                      key={i}
                      className={cn("absolute top-11 h-1.5 rounded-full", mine.length ? "bg-live" : "bg-warn-foreground")}
                      style={{ left: pct(Date.parse(w.inAt!)), width: width(Date.parse(w.inAt!), w.outAt ? Date.parse(w.outAt) : now) }}
                      title={`Clocked in ${timeText(w.inAt, tz)}${w.outAt ? `, out ${timeText(w.outAt, tz)}` : ""}`}
                    />
                  ))}
                  {showNow && <div className="absolute inset-y-0 w-0.5 bg-today" style={{ left: pct(now) }} aria-hidden="true" />}
                </div>
                <div className="flex items-center border-l px-3 py-2">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", status.cls)}>{status.text}</span>
                </div>
              </div>
            );
          })}

          {open.length > 0 && (
            <div className={cn(cols, "border-b bg-warn/40")}>
              <div className="flex items-center px-3 py-2 text-sm font-semibold text-warn-foreground">Open shifts</div>
              <div className="relative h-14">
                {open.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onEdit(s)}
                    className="absolute top-3 flex h-7 items-center overflow-hidden rounded-md border border-dashed border-warn-border bg-warn px-2 text-[11px] font-semibold whitespace-nowrap text-warn-foreground"
                    style={{ left: pct(Date.parse(s.startsAt)), width: width(Date.parse(s.startsAt), Date.parse(s.endsAt)) }}
                  >
                    {rangeText(s, tz)} · Assign
                  </button>
                ))}
              </div>
              <div className="border-l" />
            </div>
          )}

          <div className={cn(cols, "bg-muted/40")}>
            <div className="px-3 py-2">
              <div className="text-xs font-semibold">Coverage</div>
              <div className="text-xs text-muted-foreground">People scheduled each hour</div>
            </div>
            <div className="grid h-20 grid-cols-24 items-end gap-0.5 py-2" aria-label="People scheduled each hour">
              {hours.map((n, h) => (
                <div key={h} className="flex flex-col items-center gap-0.5" title={`${tickText(h)}: ${n}`}>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{n}</span>
                  <div className={cn("w-full rounded-t-sm", n === 0 ? "bg-warn-border" : "bg-shift-day")} style={{ height: `${Math.max(2, (n / max) * 44)}px` }} />
                </div>
              ))}
            </div>
            <div className="border-l px-3 py-2 text-xs text-muted-foreground">
              {hours.some((n) => n === 0) ? `${hours.filter((n) => n === 0).length} hours with nobody` : `At least ${Math.min(...hours)} at all hours`}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          On time: clocked in up to 5 minutes after the start. Late: more than 5 minutes after. The status helps you check. It does not change hours.
        </p>
        <Button size="sm" variant="outline" onClick={() => onAdd(null, date)}>
          Add a shift on {dayText(date)}
        </Button>
      </div>
    </div>
  );
}

/* Month --------------------------------------------------------------- */

export function MonthView({ data, month, onAdd, onEdit, onOpenDay }: { data: ScheduleData; month: string; onAdd: Add; onEdit: Edit; onOpenDay: (date: string) => void }) {
  const tz = data.location.timeZone;
  const dates = datesBetween(data.from, data.to);
  const cover = coverage(data.shifts, dates, tz);
  const [picked, setPicked] = useState<string>(() => (data.today.slice(0, 7) === month.slice(0, 7) ? data.today : month.slice(0, 7) + "-01"));
  const pickedShifts = shiftsOn(data.shifts, picked, tz, undefined).filter((s) => s.status !== "deleted");
  const name = (id: string | null) => (id ? (data.people.find((p) => p.id === id)?.name ?? "Someone") : "Open shift");
  const workedOn = (d: string) => data.worked.filter((w) => w.date === d).reduce((n, w) => n + w.minutes, 0);
  return (
    <div className="flex flex-wrap gap-4" data-schedule-view="month">
      <div className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-1.5 text-xs text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cover.map((c) => {
            const inMonth = c.date.slice(0, 7) === month.slice(0, 7);
            const past = c.date < data.today;
            const drafts = data.shifts.filter((s) => s.status !== "published" && shiftDate(s.startsAt, tz) === c.date).length;
            const sel = c.date === picked;
            return (
              <button
                key={c.date}
                type="button"
                onClick={() => setPicked(c.date)}
                aria-pressed={sel}
                className={cn(
                  "flex min-h-24 flex-col gap-1 border-r border-b p-2 text-left hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-28",
                  !inMonth && "bg-muted/30 text-muted-foreground",
                  sel && "bg-accent ring-2 ring-ring ring-inset"
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      c.date === data.today && "flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    )}
                  >
                    {Number(c.date.slice(8))}
                  </span>
                  {c.open > 0 && <span className="rounded-full bg-warn px-1.5 text-[10px] font-semibold text-warn-foreground">{c.open} open</span>}
                </span>
                {c.minutes > 0 || c.open > 0 ? (
                  <>
                    <span className="text-sm font-semibold tabular-nums">{hoursShort(c.minutes)} h</span>
                    <span className="hidden text-[11px] text-muted-foreground sm:block">
                      {past && workedOn(c.date) ? `Worked ${hoursShort(workedOn(c.date))} h` : `${c.people} ${c.people === 1 ? "person" : "people"}`}
                      {drafts ? ` · ${drafts} draft${drafts === 1 ? "" : "s"}` : ""}
                    </span>
                    <span className="mt-auto grid grid-cols-3 gap-0.5" aria-hidden="true">
                      {BANDS.map((b) => (
                        <span key={b} className={cn("h-1.5 rounded-full", c.counts[b] ? BAND_DOT[b] : c.gaps.includes(b) ? "border border-dashed border-warn-foreground" : "bg-muted")} />
                      ))}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">No shifts</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <aside className="flex flex-[1_1_260px] flex-col gap-3 rounded-lg border p-4" aria-label="Selected day">
        <div>
          <h3 className="font-semibold">{dayText(picked)}</h3>
          <p className="text-sm text-muted-foreground">
            {hoursShort(pickedShifts.filter((s) => s.personId).reduce((n, s) => n + scheduledMinutes(s), 0))} h scheduled · {pickedShifts.filter((s) => !s.personId).length} open
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          {pickedShifts.length === 0 && <p className="text-sm text-muted-foreground">No shifts on this day.</p>}
          {pickedShifts.map((s) => (
            <ShiftChip key={s.id} shift={s} tz={tz} label={name(s.personId)} onClick={() => onEdit(s)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onOpenDay(picked)}>
            Open the day
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd(null, picked)}>
            Add a shift
          </Button>
        </div>
        <div className="mt-2 border-t pt-3">
          <h4 className="mb-2 text-sm font-semibold">Hours in this view, by person</h4>
          <PeopleTotals data={data} />
        </div>
      </aside>
    </div>
  );
}

function PeopleTotals({ data }: { data: ScheduleData }) {
  const totals = new Map<string, number>();
  for (const s of data.shifts) if (s.personId && s.status !== "deleted") totals.set(s.personId, (totals.get(s.personId) ?? 0) + scheduledMinutes(s));
  const rows = data.people.map((p) => ({ ...p, m: totals.get(p.id) ?? 0 })).filter((p) => p.m > 0);
  const max = Math.max(1, ...rows.map((r) => r.m));
  if (!rows.length) return <p className="text-sm text-muted-foreground">No hours scheduled.</p>;
  return (
    <div className="grid gap-1.5">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,90px)_minmax(0,1fr)_56px] items-center gap-2 text-xs">
          <span className="truncate">{r.name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className="block h-full rounded-full bg-shift-day" style={{ width: `${(r.m / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums">{hoursShort(r.m)} h</span>
        </div>
      ))}
    </div>
  );
}

/* List ---------------------------------------------------------------- */

type Filter = "all" | "open" | "unpublished";

export function ListView({ data, onEdit }: { data: ScheduleData; onEdit: Edit }) {
  const tz = data.location.timeZone;
  const [filter, setFilter] = useState<Filter>("all");
  const name = (id: string | null) => (id ? (data.people.find((p) => p.id === id)?.name ?? "Someone") : "Open shift");
  const keep = (s: ShiftInfo) => (filter === "open" ? !s.personId && s.status !== "deleted" : filter === "unpublished" ? s.status !== "published" : true);
  const dates = datesBetween(data.from, data.to);
  const openCount = data.shifts.filter((s) => !s.personId && s.status !== "deleted").length;
  return (
    <div className="flex flex-col gap-3" data-schedule-view="list">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {(
          [
            ["all", "Everyone"],
            ["open", `Open shifts (${openCount})`],
            ["unpublished", `Not published (${data.unpublished})`]
          ] as Array<[Filter, string]>
        ).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} className="rounded-full" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
          </Button>
        ))}
      </div>
      {dates.map((d) => {
        const list = shiftsOn(data.shifts, d, tz, undefined).filter(keep);
        if (!list.length) return null;
        const mins = list.filter((s) => s.personId && s.status !== "deleted").reduce((n, s) => n + scheduledMinutes(s), 0);
        return (
          <section key={d} className="flex flex-col gap-1.5" aria-label={dayText(d)}>
            <div className="flex items-baseline justify-between gap-2 pt-2">
              <h3 className="text-sm font-semibold">
                {d === data.today ? "Today · " : ""}
                {dayText(d)}
              </h3>
              <span className="text-xs text-muted-foreground tabular-nums">{hoursShort(mins)} h</span>
            </div>
            {list.map((s) => {
              const band = bandOf(s.startsAt, tz);
              const open = !s.personId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onEdit(s)}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    open && "border-dashed border-warn-border bg-warn/50",
                    !open && s.status !== "published" && "border-dashed"
                  )}
                >
                  <span className={cn("size-2.5 shrink-0 rounded-full", open ? "bg-warn-foreground" : BAND_DOT[band])} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", s.status === "deleted" && "line-through")}>{name(s.personId)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {rangeText(s, tz)} · {BAND_LABELS[band]} · {durationText(scheduledMinutes(s))}
                      {s.note ? ` · ${s.note}` : ""}
                    </span>
                  </span>
                  {s.status !== "published" && (
                    <Badge variant="outline" className="shrink-0">
                      {s.status === "draft" ? "Draft" : s.status === "changed" ? "Changed" : "Deleted"}
                    </Badge>
                  )}
                  {open && <span className="shrink-0 text-xs font-semibold text-warn-foreground">Assign</span>}
                </button>
              );
            })}
          </section>
        );
      })}
      {!dates.some((d) => shiftsOn(data.shifts, d, tz, undefined).some(keep)) && <p className="text-sm text-muted-foreground">No shifts to show.</p>}
    </div>
  );
}

