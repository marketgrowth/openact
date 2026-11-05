import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { STATUSES, type Member, type Task } from "../../shared/types";
import { MONTHS, WEEKDAYS, DAY, dn, dow, ds, fmtRange, fmtShort, isoWeek, today, workDays } from "../dates";

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
      <div className="state">
        <h3>No tasks yet</h3>
        <p>Add a task with start and end dates to see it here.</p>
        {canEdit && (
          <button type="button" className="btn primary" onClick={onAdd}>
            Add the first task
          </button>
        )}
      </div>
    );
  }

  const down = (e: RPointerEvent<HTMLDivElement>, t: Task) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const mode = target.classList.contains("h-l") ? "start" : target.classList.contains("h-r") ? "end" : "move";
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
  for (let d = min; d <= max; ) {
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
      units.push({ left: (i - min) * dayW, width: dayW, label: String(new Date(i * DAY).getUTCDate()), title: `${WEEKDAYS[w]} ${fmtShort(ds(i))}`, weekend: w === 0 || w === 6, today: i === todayN });
    }
  } else {
    for (let i = min; i <= max; i += 7) {
      units.push({ left: (i - min) * dayW, width: 7 * dayW, label: `W${isoWeek(i)}`, title: `ISO week ${isoWeek(i)}, starts ${fmtShort(ds(i))}`, today: todayN >= i && todayN < i + 7 });
    }
  }

  return (
    <>
      <div className="tl-tools">
        <div className="seg" role="group" aria-label="Zoom">
          {(["day", "week"] as const).map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => {
                setZoom(z);
                try {
                  localStorage.setItem(ZOOM_KEY, z);
                } catch {
                  /* storage can be blocked */
                }
              }}
            >
              {z === "day" ? "Days" : "Weeks"}
            </button>
          ))}
        </div>
        <button type="button" className="btn ghost sm" onClick={scrollToToday}>
          Go to today
        </button>
        <div className="legend">
          {STATUSES.map((s) => (
            <span key={s.id} className="lg" style={{ ["--c" as string]: `var(--s-${s.id})` }}>
              <span className="sw" />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="gantt" ref={scroller} style={{ ["--dayw" as string]: `${dayW}px` }}>
        <div className="g-head">
          <div className="g-corner">Task</div>
          <div className="g-scale" style={{ width }}>
            <div className="g-months">
              {months.map((m) => (
                <div key={m.left} className="g-m" style={{ left: m.left, width: m.width }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="g-units">
              {units.map((u) => (
                <div key={u.left} className={`g-u${u.weekend ? " we" : ""}${u.today ? " today" : ""}`} style={{ left: u.left, width: u.width }} title={u.title}>
                  {u.label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="g-body">
          {groups.map(([phase, ts]) => {
            const s0 = Math.min(...ts.map((t) => dn(t.start!)));
            const e0 = Math.max(...ts.map((t) => dn(t.end!)));
            return (
              <div key={phase} role="rowgroup">
                <div className="g-row ph">
                  <div className="g-label">
                    <span className="ph-name">{phase}</span>
                    <span className="g-meta">
                      {ts.length} {ts.length === 1 ? "task" : "tasks"}
                    </span>
                  </div>
                  <div className="g-track" style={{ width }}>
                    <div className="g-sum" style={{ left: (s0 - min) * dayW, width: (e0 - s0 + 1) * dayW }} title={`${phase}: ${fmtRange(ds(s0), ds(e0))}`} />
                  </div>
                </div>
                {ts.map((t) => {
                  const p = preview && preview.id === t.id ? preview : null;
                  const s = p ? p.s : dn(t.start!);
                  const e = p ? p.e : Math.max(dn(t.end!), dn(t.start!));
                  const late = t.status !== "done" && t.end! < t0;
                  const who = t.assigneeId ? members[t.assigneeId] : undefined;
                  return (
                    <div className="g-row" key={t.id}>
                      <div className="g-label">
                        <button type="button" className="g-title" onClick={() => onOpen(t.id)}>
                          {t.title}
                        </button>
                        <span className="g-meta">
                          {fmtRange(t.start, t.end)} · {workDays(t.start!, t.end!)} wd{who ? ` · ${who.name || who.email}` : ""}
                        </span>
                      </div>
                      <div className="g-track" style={{ width }}>
                        <div
                          className={`g-bar${t.status === "done" ? " done" : ""}${late ? " late" : ""}${canEdit ? " edit" : ""}${p ? " drag" : ""}`}
                          style={{ left: (s - min) * dayW, width: (e - s + 1) * dayW, ["--c" as string]: `var(--s-${t.status})` }}
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
                        >
                          <span className="g-bar-t">{zoom === "day" ? fmtRange(ds(s), ds(e)) : ""}</span>
                          {canEdit && (
                            <>
                              <span className="h h-l" />
                              <span className="h h-r" />
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
            <div className="g-row">
              <div className="g-label">
                <span className="g-meta">No scheduled tasks</span>
              </div>
              <div className="g-track" style={{ width }} />
            </div>
          )}
          {todayN >= min && todayN <= max && <div className="g-today" style={{ left: `calc(var(--labelw) + ${(todayN - min) * dayW + dayW / 2 - 1}px)` }} />}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="undated">
          <h3>Not scheduled ({undated.length})</h3>
          <p className="hint">Add start and end dates to show these tasks on the timeline.</p>
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
