import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { STATUSES, type Member, type Task } from "../../shared/types";
import { MONTHS, WEEKDAYS, DAY, dn, dow, ds, fmtRange, fmtShort, isoWeek, today, workDays } from "../dates";
import { EmptyState } from "../pages/Projects";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const LABEL_W = 248;

interface Props {
  tasks: Task[];
  hasAny: boolean;
  members: Record<string, Member>;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onReschedule: (id: string, start: string, end: string) => void;
  onDragState: (dragging: boolean) => void;
  onAdd: () => void;
}

type Zoom = "day" | "week";
const ZOOM_KEY = "openact-zoom";

function savedZoom(): Zoom {
  try {
    return localStorage.getItem(ZOOM_KEY) === "week" ? "week" : "day";
  } catch {
    return "day";
  }
}

interface Drag {
  id: string;
  mode: "move" | "start" | "end";
  x0: number;
  s0: number;
  e0: number;
  moved: boolean;
}

export function Timeline({ tasks, hasAny, members, canEdit, onOpen, onReschedule, onDragState, onAdd }: Props) {
  const [zoom, setZoom] = useState<Zoom>(savedZoom);
  const [preview, setPreview] = useState<{ id: string; s: number; e: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const t0 = today();
  const todayN = dn(t0);
  const dayW = zoom === "day" ? 32 : 12;

  const dated = useMemo(() => tasks.filter((t) => t.start && t.end), [tasks]);
  const undated = useMemo(() => tasks.filter((t) => !(t.start && t.end)), [tasks]);

  // The visible range: Monday before the earliest task to Sunday after the latest, always including today.
  const { min, max } = useMemo(() => {
    let lo = todayN - 7;
    let hi = todayN + 42;
    for (const t of dated) {
      lo = Math.min(lo, dn(t.start!) - 3);
      hi = Math.max(hi, dn(t.end!) + 7);
    }
    lo -= (dow(lo) + 6) % 7;
    hi += 6 - ((dow(hi) + 6) % 7);
    return { min: lo, max: hi };
  }, [dated, todayN]);

  const width = (max - min + 1) * dayW;

  const scrollToToday = () => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (todayN - min) * dayW - (zoom === "day" ? 4 : 14) * dayW);
  };
  // Open on today, and again when the zoom changes.
  useLayoutEffect(scrollToToday, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of dated) {
      const k = t.phase || "No phase";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return [...m.entries()]
      .map(([phase, ts]) => [phase, ts.sort((a, b) => a.start!.localeCompare(b.start!) || a.end!.localeCompare(b.end!))] as const)
      .sort((a, b) => a[1][0].start!.localeCompare(b[1][0].start!));
  }, [dated]);

  if (!hasAny) {
    return (
      <EmptyState title="No tasks yet" text="Add a task with start and end dates to see it here.">
        {canEdit && <Button onClick={onAdd}>Add the first task</Button>}
      </EmptyState>
    );
  }

  const down = (e: RPointerEvent<HTMLDivElement>, t: Task) => {
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).dataset.handle;
    const mode = handle === "start" ? "start" : handle === "end" ? "end" : "move";
    drag.current = { id: t.id, mode, x0: e.clientX, s0: dn(t.start!), e0: Math.max(dn(t.end!), dn(t.start!)), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragState(true);
  };

  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 4) d.moved = true;
    if (!d.moved || !canEdit) return;
    const dd = Math.round(dx / dayW);
    let s = d.s0;
    let en = d.e0;
    if (d.mode === "move") {
      s += dd;
      en += dd;
    } else if (d.mode === "start") s = Math.min(d.s0 + dd, d.e0);
    else en = Math.max(d.e0 + dd, d.s0);
    if (!preview || preview.s !== s || preview.e !== en) setPreview({ id: d.id, s, e: en });
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    onDragState(false);
    const p = preview;
    setPreview(null);
    if (!d) return;
    if (!d.moved) {
      onOpen(d.id);
      return;
    }
    if (canEdit && p && p.id === d.id && (p.s !== d.s0 || p.e !== d.e0)) onReschedule(d.id, ds(p.s), ds(p.e));
  };

  const cancel = () => {
    drag.current = null;
    setPreview(null);
    onDragState(false);
  };

  // Header: months, then days or ISO weeks.
  const months: Array<{ left: number; width: number; label: string }> = [];
  for (let d = min; d <= max;) {
    const dt = new Date(d * DAY);
    const end = Math.min(max, Math.round(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / DAY) - 1);
    const w = (end - d + 1) * dayW;
    months.push({ left: (d - min) * dayW, width: w, label: w > 70 ? `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` : MONTHS[dt.getUTCMonth()] });
    d = end + 1;
  }
  const units: Array<{ left: number; width: number; label: string; title: string; weekend?: boolean; today?: boolean }> = [];
  if (zoom === "day") {
    for (let i = min; i <= max; i++) {
      const w = dow(i);
      units.push({
        left: (i - min) * dayW,
        width: dayW,
        label: String(new Date(i * DAY).getUTCDate()),
        title: `${WEEKDAYS[w]} ${fmtShort(ds(i))}`,
        weekend: w === 0 || w === 6,
        today: i === todayN
      });
    }
  } else {
    for (let i = min; i <= max; i += 7) {
      units.push({
        left: (i - min) * dayW,
        width: 7 * dayW,
        label: `W${isoWeek(i)}`,
        title: `ISO week ${isoWeek(i)}, starts ${fmtShort(ds(i))}`,
        today: todayN >= i && todayN < i + 7
      });
    }
  }

  const pickZoom = (z: Zoom) => {
    setZoom(z);
    try {
      localStorage.setItem(ZOOM_KEY, z);
    } catch {
      /* storage can be blocked */
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={zoom} onValueChange={(v) => v && pickZoom(v as Zoom)} aria-label="Zoom">
          <ToggleGroupItem value="day" className="px-3">
            Days
          </ToggleGroupItem>
          <ToggleGroupItem value="week" className="px-3">
            Weeks
          </ToggleGroupItem>
        </ToggleGroup>
        <Button type="button" variant="outline" size="sm" onClick={scrollToToday}>
          Go to today
        </Button>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground md:ml-auto" aria-label="Status colors">
          {STATUSES.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-[2px]" style={{ background: `var(--s-${s.id})` }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div
        className="relative max-h-[calc(100dvh-260px)] min-h-[340px] overflow-auto overscroll-contain rounded-xl border bg-card"
        ref={scroller}
        style={{ ["--dayw" as string]: `${dayW}px` }}
        data-gantt=""
      >
        <div className="sticky top-0 z-[4] flex w-max min-w-full border-b bg-card">
          <div
            className="sticky left-0 z-[5] flex shrink-0 items-end border-r bg-card px-3 py-2 text-xs font-medium text-muted-foreground"
            style={{ width: LABEL_W }}
          >
            Task
          </div>
          <div className="relative shrink-0" style={{ width }}>
            <div className="relative h-6">
              {months.map((m) => (
                <div
                  key={m.left}
                  className="absolute top-0 h-6 overflow-hidden border-l px-2 py-1 text-xs font-medium whitespace-nowrap"
                  style={{ left: m.left, width: m.width }}
                >
                  {m.label}
                </div>
              ))}
            </div>
            <div className="relative h-6 border-t">
              {units.map((u) => (
                <div
                  key={u.left}
                  className={cn(
                    "absolute top-0 flex h-[23px] items-center justify-center border-l font-mono text-[11px] text-muted-foreground tabular",
                    u.weekend && "bg-weekend text-muted-foreground/60",
                    u.today && "font-medium text-today shadow-[inset_0_-2px_0_var(--today)]"
                  )}
                  style={{ left: u.left, width: u.width }}
                  title={u.title}
                >
                  {u.label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="relative w-max min-w-full">
          {groups.map(([phase, ts]) => {
            const s0 = Math.min(...ts.map((t) => dn(t.start!)));
            const e0 = Math.max(...ts.map((t) => dn(t.end!)));
            return (
              <div key={phase} role="rowgroup">
                <div className="flex h-8 border-b bg-muted/60">
                  <div className="sticky left-0 z-[2] flex shrink-0 items-center justify-between gap-2 border-r bg-muted px-3" style={{ width: LABEL_W }}>
                    <span className="truncate text-xs font-semibold tracking-wide uppercase">{phase}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {ts.length} {ts.length === 1 ? "task" : "tasks"}
                    </span>
                  </div>
                  <div className="relative shrink-0" style={{ width }}>
                    <div
                      className="absolute top-3 h-2 rounded-sm bg-muted-foreground/50"
                      style={{ left: (s0 - min) * dayW, width: (e0 - s0 + 1) * dayW }}
                      title={`${phase}: ${fmtRange(ds(s0), ds(e0))}`}
                    />
                  </div>
                </div>
                {ts.map((t) => {
                  const p = preview && preview.id === t.id ? preview : null;
                  const s = p ? p.s : dn(t.start!);
                  const e = p ? p.e : Math.max(dn(t.end!), dn(t.start!));
                  const late = t.status !== "done" && t.end! < t0;
                  const who = t.assigneeId ? members[t.assigneeId] : undefined;
                  return (
                    <div className="flex h-[42px] border-b" key={t.id}>
                      <div className="sticky left-0 z-[2] flex min-w-0 shrink-0 flex-col justify-center border-r bg-card px-3" style={{ width: LABEL_W }}>
                        <button
                          type="button"
                          className="truncate text-left text-sm leading-tight font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                          onClick={() => onOpen(t.id)}
                          data-gantt-title=""
                        >
                          {t.title}
                        </button>
                        <span className="truncate text-[11px] text-muted-foreground tabular">
                          {fmtRange(t.start, t.end)} · {workDays(t.start!, t.end!)} wd{who ? ` · ${who.name || who.email}` : ""}
                        </span>
                      </div>
                      <div className="gantt-track relative shrink-0" style={{ width }}>
                        <div
                          className={cn(
                            "absolute top-[9px] flex h-6 cursor-pointer touch-pan-y items-center overflow-hidden rounded-md px-2 text-[var(--bar-ink)] select-none",
                            canEdit && "cursor-grab",
                            t.status === "done" && "opacity-60",
                            late && "ring-2 ring-today ring-offset-2 ring-offset-card",
                            p && "z-[3] cursor-grabbing shadow-lg"
                          )}
                          style={{ left: (s - min) * dayW, width: (e - s + 1) * dayW, background: `var(--s-${t.status})` }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${t.title}, ${fmtRange(t.start, t.end)}`}
                          onPointerDown={(ev) => down(ev, t)}
                          onPointerMove={move}
                          onPointerUp={up}
                          onPointerCancel={cancel}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              onOpen(t.id);
                            }
                          }}
                          data-gantt-bar=""
                        >
                          <span className="pointer-events-none truncate font-mono text-[11px] font-medium">{zoom === "day" ? fmtRange(ds(s), ds(e)) : ""}</span>
                          {canEdit && (
                            <>
                              <span className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-(--bar-ink)/20" data-handle="start" />
                              <span className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-(--bar-ink)/20" data-handle="end" />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!dated.length && (
            <div className="flex h-[42px] border-b">
              <div className="sticky left-0 z-[2] flex shrink-0 items-center border-r bg-card px-3 text-xs text-muted-foreground" style={{ width: LABEL_W }}>
                No scheduled tasks
              </div>
              <div className="gantt-track relative shrink-0" style={{ width }} />
            </div>
          )}
          {todayN >= min && todayN <= max && (
            <div
              className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-today"
              style={{ left: LABEL_W + (todayN - min) * dayW + dayW / 2 - 1 }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="grid gap-2 rounded-xl border p-4">
          <h3 className="text-sm font-medium">Not scheduled ({undated.length})</h3>
          <p className="text-xs text-muted-foreground">Add start and end dates to show these tasks on the timeline.</p>
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
