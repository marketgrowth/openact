import { useEffect, useMemo, useState, type DragEvent } from "react";
import { STATUSES, type Column, type Member, type Task } from "../../shared/types";
import { DAY, MONTHS, WEEKDAYS, dn, dow, ds, fmtRange, today } from "../dates";
import { Icon } from "../ui";
import { EmptyState } from "../pages/Projects";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Month calendar. A task shows as a card on its start date and as a deadline pill on its end date.
 * One-day tasks show one card. Every card and pill opens the task drawer.
 * Editors drag a card to move the whole task, or drag a deadline pill to change only the end date.
 */

interface Props {
  columns: Column[];
  tasks: Task[];
  hasAny: boolean;
  members: Record<string, Member>;
  canEdit: boolean;
  /** A date the page wants in view, for example from an agent tool call. */
  focusDate: string | null;
  onOpen: (id: string) => void;
  onAdd: (date: string) => void;
  onReschedule: (id: string, start: string, end: string) => void;
  onDragState: (dragging: boolean) => void;
}

type Kind = "start" | "single" | "due";
interface Entry {
  task: Task;
  kind: Kind;
}

const MAX_PER_DAY = 3;
const PRIORITY_RANK = { high: 0, med: 1, low: 2 } as const;
const statusLabel = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id;
const monthOf = (date: string) => date.slice(0, 7);

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function Calendar({ columns, tasks, hasAny, members, canEdit, focusDate, onOpen, onAdd, onReschedule, onDragState }: Props) {
  const t0 = today();
  const todayN = dn(t0);
  const labelOf = (t: Task) => columns.find((c) => c.id === t.columnId)?.name ?? statusLabel(t.status);
  const [cursor, setCursor] = useState(() => monthOf(focusDate ?? t0));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [drag, setDrag] = useState<{ id: string; kind: Kind } | null>(null);
  const [over, setOver] = useState<number | null>(null);

  // Follow a new focus date from the page (or an agent).
  useEffect(() => {
    if (focusDate) setCursor(monthOf(focusDate));
  }, [focusDate]);

  const byDay = useMemo(() => {
    const m = new Map<number, Entry[]>();
    const put = (d: number, e: Entry) => {
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(e);
    };
    for (const t of tasks) {
      if (!t.start) continue;
      const end = t.end ?? t.start;
      if (end === t.start) put(dn(t.start), { task: t, kind: "single" });
      else {
        put(dn(t.start), { task: t, kind: "start" });
        put(dn(end), { task: t, kind: "due" });
      }
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          (a.kind === "due" ? 1 : 0) - (b.kind === "due" ? 1 : 0) ||
          PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
          a.task.title.localeCompare(b.task.title)
      );
    }
    return m;
  }, [tasks]);

  const undated = useMemo(() => tasks.filter((t) => !t.start), [tasks]);

  const first = dn(`${cursor}-01`);
  const last = dn(`${shiftMonth(cursor, 1)}-01`) - 1;
  const gridStart = first - dow(first);
  const gridEnd = last + (6 - dow(last));
  const days: number[] = [];
  for (let d = gridStart; d <= gridEnd; d++) days.push(d);
  const [cy, cm] = cursor.split("-").map(Number);
  const monthTitle = `${new Date(Date.UTC(cy, cm - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${cy}`;
  const focusN = focusDate ? dn(focusDate) : null;

  if (!hasAny) {
    return (
      <EmptyState title="No tasks yet" text="Add a task with dates to see it on the calendar.">
        {canEdit && <Button onClick={() => onAdd(t0)}>Add the first task</Button>}
      </EmptyState>
    );
  }

  const endDrag = () => {
    setDrag(null);
    setOver(null);
    onDragState(false);
  };

  const drop = (e: DragEvent, day: number) => {
    e.preventDefault();
    const d = drag;
    endDrag();
    if (!d) return;
    const t = tasks.find((x) => x.id === d.id);
    if (!t || !t.start) return;
    const s = dn(t.start);
    const en = dn(t.end ?? t.start);
    if (d.kind === "due") {
      const newEnd = Math.max(day, s);
      if (newEnd !== en) onReschedule(t.id, t.start, ds(newEnd));
    } else if (day !== s) {
      onReschedule(t.id, ds(day), ds(en + (day - s)));
    }
  };

  const renderEntry = (e: Entry, compact = false) => {
    const t = e.task;
    const late = !!t.end && t.status !== "done" && t.end < t0;
    const who = t.assigneeId ? members[t.assigneeId] : undefined;
    const whoName = who ? who.name || who.email : "";
    const key = `${t.id}-${e.kind}`;
    const common = {
      role: "button" as const,
      tabIndex: 0,
      draggable: canEdit,
      onClick: () => onOpen(t.id),
      onKeyDown: (ev: React.KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen(t.id);
        }
      },
      onDragStart: (ev: DragEvent) => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", `${t.id}|${e.kind}`);
        setDrag({ id: t.id, kind: e.kind });
        onDragState(true);
      },
      onDragEnd: endDrag
    };
    const color = { borderLeftColor: `var(--s-${t.status})` };
    if (e.kind === "due") {
      return (
        <div
          key={key}
          {...common}
          className={cn(
            "flex min-w-0 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
            late ? "border-priority-high/40 text-priority-high" : "text-muted-foreground",
            t.status === "done" && "line-through opacity-60"
          )}
          aria-label={`Deadline: ${t.title}. ${labelOf(t)}.`}
          title={`Deadline for ${t.title} (${fmtRange(t.start, t.end)})`}
          data-cal-due=""
        >
          <Icon name="flag" size={12} className="shrink-0" />
          <span className="truncate">{t.title}</span>
        </div>
      );
    }
    return (
      <div
        key={key}
        {...common}
        className={cn(
          "grid min-w-0 cursor-pointer gap-0.5 rounded-md border border-l-[3px] bg-card px-2 py-1 text-xs shadow-xs outline-none hover:border-foreground/20 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          late && "ring-1 ring-priority-high/50",
          t.status === "done" && "opacity-60",
          compact && "py-1.5"
        )}
        style={color}
        aria-label={`${t.title}. ${fmtRange(t.start, t.end)}. ${labelOf(t)}.`}
        title={`${t.title} (${fmtRange(t.start, t.end)})`}
        data-cal-card=""
      >
        <span className={cn("truncate font-medium", t.status === "done" && "line-through")}>{t.title}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {e.kind === "start" ? `${labelOf(t)} · ends ${fmtRange(t.end, null)}` : labelOf(t)}
          {whoName ? ` · ${whoName}` : ""}
        </span>
      </div>
    );
  };

  const dayLabel = (d: number) => {
    const date = new Date(d * DAY);
    return date.getUTCDate() === 1 ? `${MONTHS[date.getUTCMonth()]} 1` : String(date.getUTCDate());
  };

  // Phone layout: an agenda of the days in this month that have entries.
  const agendaDays = days.filter((d) => d >= first && d <= last && byDay.has(d));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight" data-cal-month="">
          {monthTitle}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Previous month"
            onClick={() => setCursor((c) => shiftMonth(c, -1))}
          >
            <Icon name="left" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setCursor(monthOf(t0))}>
            Today
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Next month" onClick={() => setCursor((c) => shiftMonth(c, 1))}>
            <Icon name="right" />
          </Button>
        </div>
      </div>
      <p className="-mt-2 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        <span className="inline-block h-3 w-1 rounded-sm bg-status-todo" aria-hidden="true" /> Card: the task starts that day.
        <Icon name="flag" size={12} className="ml-2" /> Pill: the deadline.
        {canEdit ? " Drag a card to move the task. Drag a pill to change the deadline." : ""}
      </p>

      <div className="hidden overflow-hidden rounded-xl border bg-border md:grid md:grid-cols-7 md:gap-px" role="grid" aria-label={monthTitle} data-cal-grid="">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-muted/60 px-2 py-1.5 text-xs font-medium text-muted-foreground" role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const entries = byDay.get(d) ?? [];
          const open = expanded.has(d);
          const shown = open ? entries : entries.slice(0, MAX_PER_DAY);
          const hidden = entries.length - shown.length;
          const outside = d < first || d > last;
          return (
            <div
              key={d}
              role="gridcell"
              aria-label={`${WEEKDAYS[dow(d)]} ${ds(d)}, ${entries.length} ${entries.length === 1 ? "item" : "items"}`}
              className={cn(
                "group/day flex min-h-28 min-w-0 flex-col gap-1 bg-card p-1.5",
                outside && "bg-muted",
                d === focusN && "ring-2 ring-ring ring-inset",
                over === d && "bg-accent"
              )}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (over !== d) setOver(d);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === d ? null : o));
              }}
              onDrop={(e) => drop(e, d)}
            >
              <div className="flex h-6 items-center justify-between">
                <span
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs tabular",
                    outside ? "text-muted-foreground/60" : "text-muted-foreground",
                    d === todayN && "bg-today font-medium text-[var(--bar-ink)]"
                  )}
                >
                  {dayLabel(d)}
                </span>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100"
                    aria-label={`Add a task on ${ds(d)}`}
                    onClick={() => onAdd(ds(d))}
                  >
                    <Icon name="plus" size={14} />
                  </Button>
                )}
              </div>
              <div className="grid min-w-0 gap-1">
                {shown.map((e) => renderEntry(e))}
                {hidden > 0 && (
                  <button
                    type="button"
                    className="rounded px-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setExpanded((s) => new Set(s).add(d))}
                  >
                    {hidden} more
                  </button>
                )}
                {open && entries.length > MAX_PER_DAY && (
                  <button
                    type="button"
                    className="rounded px-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        n.delete(d);
                        return n;
                      })
                    }
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 md:hidden" data-cal-agenda="">
        {agendaDays.length === 0 && <p className="text-sm text-muted-foreground">Nothing starts or is due in {monthTitle}.</p>}
        {agendaDays.map((d) => (
          <section key={d} className="grid gap-2">
            <h3 className={cn("text-sm font-medium", d === todayN && "text-today")}>
              {WEEKDAYS[dow(d)]}, {MONTHS[new Date(d * DAY).getUTCMonth()]} {new Date(d * DAY).getUTCDate()}
              {d === todayN && " · Today"}
            </h3>
            <div className="grid gap-1.5">{(byDay.get(d) ?? []).map((e) => renderEntry(e, true))}</div>
          </section>
        ))}
      </div>

      {undated.length > 0 && (
        <div className="grid gap-2 rounded-xl border p-4">
          <h3 className="text-sm font-medium">Not scheduled ({undated.length})</h3>
          <p className="text-xs text-muted-foreground">Add start and end dates to show these tasks on the calendar.</p>
          <div className="flex flex-wrap gap-2">
            {undated.map((t) => (
              <Button key={t.id} type="button" variant="outline" size="sm" onClick={() => onOpen(t.id)}>
                {t.title}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
