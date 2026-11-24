import { useEffect, useState } from "react";
import { Icon, Link, Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { cn } from "@openact/ui/lib/utils";
import { HOME, addDays, hoursText, weekStart, type LocationInfo } from "../shared/rules";
import { hoursShort, monthGrid, scheduledMinutes, shiftDate, weekMinutes, type ScheduleData } from "../shared/schedule";
import { companyApi, dayText, useCompanyData, useLocationPick, useMe, zoneName } from "./lib";
import { DayView, ListView, MonthView, WeekView } from "./ScheduleViews";
import { Legend } from "./schedule-parts";
import ShiftEditor, { type EditTarget } from "./ShiftEditor";

/*
 * Schedule: managers plan shifts for each person at a location, then publish them.
 * Four views: Week (a roster), Day (a timeline against the time clock), Month (a calendar) and List.
 */

const VIEWS = [
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "list", label: "List" }
] as const;
type View = (typeof VIEWS)[number]["id"];
const VIEW_KEY = "openact.workspent.scheduleView";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeOf(view: View, anchor: string): { from: string; to: string } {
  if (view === "week") return { from: weekStart(anchor), to: addDays(weekStart(anchor), 6) };
  // The day before too, for night shifts that run into the day.
  if (view === "day") return { from: addDays(anchor, -1), to: anchor };
  if (view === "month") return monthGrid(anchor);
  return { from: weekStart(anchor), to: addDays(weekStart(anchor), 13) };
}

function step(view: View, anchor: string, dir: 1 | -1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "month") {
    const [y, m] = anchor.split("-").map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    return d.toISOString().slice(0, 10);
  }
  return addDays(anchor, 7 * dir);
}

function title(view: View, anchor: string): string {
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(d + "T00:00:00Z"));
  if (view === "day") return f(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (view === "month") return f(anchor, { month: "long", year: "numeric" });
  const r = rangeOf(view, anchor);
  return `${f(r.from, { month: "short", day: "numeric" })} to ${f(r.to, { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function SchedulePage() {
  const me = useMe();
  const manages = !!me.data && (me.data.canManageAll || me.data.canSetup || me.data.managedLocationIds.length > 0);
  const locs = useCompanyData<{ locations: LocationInfo[] }>(manages ? "/locations" : null);
  const [locationId, pickLocation] = useLocationPick(locs.data?.locations ?? null);
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as View | null;
      if (v && VIEWS.some((x) => x.id === v)) return v;
    } catch {
      // Storage can be off.
    }
    return typeof window !== "undefined" && window.innerWidth < 640 ? "list" : "week";
  });
  const [anchor, setAnchor] = useState(localToday);
  const range = rangeOf(view, anchor);
  const sched = useCompanyData<ScheduleData>(locationId ? `/locations/${locationId}/schedule?from=${range.from}&to=${range.to}` : null);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // The choice then lasts for this page only.
    }
  };

  // Refresh every two minutes, so the day view and the status stay current.
  const { reload } = sched;
  useEffect(() => {
    const t = setInterval(reload, 120_000);
    return () => clearInterval(t);
  }, [reload]);

  const d = sched.data && sched.data.location.id === locationId && sched.data.from === range.from && sched.data.to === range.to ? sched.data : null;
  const base = sched.companyId ? companyApi(sched.companyId) : null;

  async function publish() {
    if (!d || !base) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ published: number }>(`${base}/locations/${d.location.id}/schedule/publish`, { method: "POST", body: { from: d.from, to: d.to } });
      setMessage({ tone: "info", text: `Published ${r.published} change${r.published === 1 ? "" : "s"}. Staff see the shifts on My time.` });
      sched.reload();
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function copyWeek() {
    if (!d || !base) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ copied: number; skipped: number }>(`${base}/locations/${d.location.id}/schedule/copy`, { method: "POST", body: { weekStart: range.from } });
      setMessage({
        tone: "info",
        text: r.copied
          ? `Copied ${r.copied} shift${r.copied === 1 ? "" : "s"} from last week as drafts.${r.skipped ? ` ${r.skipped} skipped: an overlap, or the person is off.` : ""}`
          : "Last week has no shifts to copy."
      });
      sched.reload();
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  // Stats for the visible range. The day view counts only its own day.
  const tz = d?.location.timeZone ?? "UTC";
  const inView = d ? d.shifts.filter((s) => s.status !== "deleted" && (view !== "day" || shiftDate(s.startsAt, tz) === anchor)) : [];
  const minutes = inView.filter((s) => s.personId).reduce((n, s) => n + scheduledMinutes(s), 0);
  const openCount = inView.filter((s) => !s.personId).length;
  const overPeople = d && view === "week" ? [...weekMinutes(d.shifts, range.from, tz).values()].filter((m) => m > d.weekLimitMinutes).length : 0;

  return (
    <>
      <SiteHeader title="Schedule">
        {d && (
          <>
            {view === "week" && (
              <Button variant="outline" size="sm" onClick={copyWeek} disabled={busy}>
                <Icon name="copy" />
                <span className="hidden sm:inline">Copy last week</span>
                <span className="sr-only sm:hidden">Copy last week</span>
              </Button>
            )}
            <Button size="sm" onClick={publish} disabled={busy || d.unpublished === 0}>
              <Icon name="send" />
              <span className="hidden sm:inline">{d.unpublished ? `Publish ${d.unpublished} change${d.unpublished === 1 ? "" : "s"}` : "All published"}</span>
              <span className="sr-only sm:hidden">Publish</span>
            </Button>
          </>
        )}
      </SiteHeader>
      <PageBody>
        {(me.error || locs.error || sched.error) && <Notice tone="error">{me.error || locs.error || sched.error}</Notice>}
        {me.data && !manages && (
          <Notice tone="info">
            You do not manage a location. <Link to={`${HOME}/my-time`} className="underline">See your own shifts on My time.</Link>
          </Notice>
        )}
        {locs.data && !locationId && <Notice tone="info">There is no location yet. Add one in Locations and devices.</Notice>}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {locationId && locs.data && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">{title(view, anchor)}</h2>
              <p className="text-sm text-muted-foreground">
                {d ? `${d.location.name} · ${zoneName(d.location.timeZone)}` : "Loading…"} · Staff see a shift after you publish it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="View" className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={view === v.id}
                    onClick={() => setView(v.id)}
                    className={cn(
                      "min-h-8 rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      view === v.id ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <NativeSelect value={locationId} onChange={(e) => pickLocation(e.target.value)} aria-label="Location" className="w-56">
                {locs.data.locations
                  .filter((l) => l.canManage && !l.isArchived)
                  .map((l) => (
                    <NativeSelectOption key={l.id} value={l.id}>
                      {l.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <div className="inline-flex items-center gap-1">
                <Button variant="outline" size="icon" aria-label="Back" onClick={() => setAnchor(step(view, anchor, -1))}>
                  <Icon name="left" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAnchor(d?.today ?? localToday())}>
                  Today
                </Button>
                <Button variant="outline" size="icon" aria-label="Next" onClick={() => setAnchor(step(view, anchor, 1))}>
                  <Icon name="right" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {d && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-schedule-stats="">
              <Stat label="Hours scheduled" value={hoursShort(minutes)} />
              <Stat label="Open shifts to fill" value={String(openCount)} warn={openCount > 0} />
              {view === "week" ? (
                <Stat label={`People over ${hoursShort(d.weekLimitMinutes)} hours`} value={String(overPeople)} warn={overPeople > 0} />
              ) : (
                <Stat label="People scheduled" value={String(new Set(inView.map((s) => s.personId).filter(Boolean)).size)} />
              )}
              <Stat label="Changes not published" value={String(d.unpublished)} />
            </div>
            {view !== "day" && <Legend />}
            {d.people.length === 0 && d.shifts.length === 0 && (
              <Notice tone="info">
                Nobody is at this location yet. Add people in <Link to={`${HOME}/people`} className="underline">People and PINs</Link>, then add their shifts.
              </Notice>
            )}
            {view === "week" && <WeekView data={d} from={range.from} onAdd={(personId, date) => setEdit({ personId, date })} onEdit={(shift) => setEdit({ shift })} />}
            {view === "day" && <DayView data={d} date={anchor} onAdd={(personId, date) => setEdit({ personId, date })} onEdit={(shift) => setEdit({ shift })} />}
            {view === "month" && (
              <MonthView
                key={anchor.slice(0, 7)}
                data={d}
                month={anchor}
                onAdd={(personId, date) => setEdit({ personId, date })}
                onEdit={(shift) => setEdit({ shift })}
                onOpenDay={(date) => {
                  setAnchor(date);
                  setView("day");
                }}
              />
            )}
            {view === "list" && <ListView data={d} onEdit={(shift) => setEdit({ shift })} />}
            {view === "list" && (
              <div>
                <Button variant="outline" size="sm" onClick={() => setEdit({ personId: null, date: d.today >= d.from && d.today <= d.to ? d.today : d.from })}>
                  <Icon name="plus" />
                  Add a shift
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Scheduled hours are the shift length less the meal break. The schedule plans the work. Hours for payroll still come from the time clock. Showing {dayText(range.from)} to{" "}
              {dayText(range.to)}.
            </p>
          </>
        )}
      </PageBody>
      {edit && d && sched.companyId && (
        <ShiftEditor
          companyId={sched.companyId}
          data={d}
          target={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            sched.reload();
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <Card className={cn("gap-1 py-4", warn && "border-warn-border bg-warn")}>
      <CardContent className="px-4">
        <div className={cn("text-2xl font-semibold tabular-nums", warn && "text-warn-foreground")}>{value}</div>
        <div className={cn("text-xs", warn ? "text-warn-foreground" : "text-muted-foreground")}>{label}</div>
      </CardContent>
    </Card>
  );
}
