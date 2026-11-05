import { useEffect, useMemo, useState, type DragEvent } from "react";
import { STATUSES, type Column, type Member, type Task } from "../../shared/types";
import { DAY, MONTHS, WEEKDAYS, dn, dow, ds, fmtRange, today } from "../dates";
import { Icon } from "../ui";

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
      list.sort((a, b) => (a.kind === "due" ? 1 : 0) - (b.kind === "due" ? 1 : 0) || PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] || a.task.title.localeCompare(b.task.title));
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
      <div className="state">
        <h3>No tasks yet</h3>
        <p>Add a task with dates to see it on the calendar.</p>
        {canEdit && (
          <button type="button" className="btn primary" onClick={() => onAdd(t0)}>
            Add the first task
          </button>
        )}
      </div>
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
      onDragEnd: endDrag,
      style: { ["--c" as string]: `var(--s-${t.status})` }
    };
    if (e.kind === "due") {
      return (
        <div key={key} {...common} className={`cal-due${late ? " late" : ""}${t.status === "done" ? " done" : ""}`} aria-label={`Deadline: ${t.title}. ${labelOf(t)}.`} title={`Deadline for ${t.title} (${fmtRange(t.start, t.end)})`}>
          <Icon name="flag" size={13} />
          <span className="cal-due-t">{t.title}</span>
        </div>
      );
    }
    return (
      <div
        key={key}
        {...common}
        className={`cal-card${late ? " late" : ""}${t.status === "done" ? " done" : ""}${compact ? " compact" : ""}`}
        aria-label={`${t.title}. ${fmtRange(t.start, t.end)}. ${labelOf(t)}.`}
        title={`${t.title} (${fmtRange(t.start, t.end)})`}
      >
        <span className="cal-title">
          <Icon name="doc" size={14} />
          <span>{t.title}</span>
        </span>
        <span className="cal-tags">
          <span className="tag tag-phase">
            {t.phase || "No phase"}
            {whoName ? ` · ${whoName}` : ""}
          </span>
          <span className="tag tag-status">{e.kind === "start" ? `${labelOf(t)} · ends ${fmtRange(t.end, null)}` : labelOf(t)}</span>
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
    <>
      <div className="cal-tools">
        <h2 className="cal-month">{monthTitle}</h2>
        <span className="grow" />
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setCursor((c) => shiftMonth(c, -1))}>
            <Icon name="left" />
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setCursor(monthOf(t0))}>
            Today
          </button>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setCursor((c) => shiftMonth(c, 1))}>
            <Icon name="right" />
          </button>
        </div>
      </div>
      <p className="hint cal-legend">
        <Icon name="doc" size={13} /> Card: the task starts that day. <Icon name="flag" size={13} /> Pill: the deadline.
        {canEdit ? " Drag a card to move the task. Drag a pill to change the deadline." : ""}
      </p>

      <div className="cal-grid" role="grid" aria-label={monthTitle}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-wd" role="columnheader">
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
              className={`cal-cell${outside ? " out" : ""}${d === todayN ? " is-today" : ""}${d === focusN ? " focus" : ""}${over === d ? " over" : ""}`}
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
              <div className="cal-day">
                {canEdit && (
                  <button type="button" className="cal-add" aria-label={`Add a task on ${ds(d)}`} onClick={() => onAdd(ds(d))}>
                    <Icon name="plus" size={14} />
                  </button>
                )}
                <span className="cal-num">{dayLabel(d)}</span>
              </div>
              <div className="cal-items">
                {shown.map((e) => renderEntry(e))}
                {hidden > 0 && (
                  <button type="button" className="cal-more" onClick={() => setExpanded((s) => new Set(s).add(d))}>
                    {hidden} more
                  </button>
                )}
                {open && entries.length > MAX_PER_DAY && (
                  <button
                    type="button"
                    className="cal-more"
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

      <div className="cal-agenda">
        {agendaDays.length === 0 && <p className="hint">Nothing starts or is due in {monthTitle}.</p>}
        {agendaDays.map((d) => (
          <section key={d} className={`ag-day${d === todayN ? " is-today" : ""}`}>
            <h3>
              {WEEKDAYS[dow(d)]}, {MONTHS[new Date(d * DAY).getUTCMonth()]} {new Date(d * DAY).getUTCDate()}
            </h3>
            <div className="cal-items">{(byDay.get(d) ?? []).map((e) => renderEntry(e, true))}</div>
          </section>
        ))}
      </div>

      {undated.length > 0 && (
        <div className="undated">
          <h3>Not scheduled ({undated.length})</h3>
          <p className="hint">Add start and end dates to show these tasks on the calendar.</p>
          <div className="row-wrap">
            {undated.map((t) => (
              <button key={t.id} type="button" className="btn sm" onClick={() => onOpen(t.id)}>
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
