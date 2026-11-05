import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { CATEGORY_LABELS, PRIORITIES, STATUS_IDS, type Attachment, type Column, type Member, type Status, type Task } from "../../shared/types";
import { fmtRange, today, workDays } from "../dates";
import { Avatar, Icon } from "../ui";

export interface ColumnActions {
  add: (name: string, category: Status) => void;
  rename: (id: string, name: string) => void;
  setCategory: (id: string, category: Status) => void;
  moveAfter: (id: string, afterId: string | null) => void;
  remove: (id: string, moveTo: string | null) => void;
}

interface Props {
  columns: Column[];
  tasks: Task[];
  hasAny: boolean;
  members: Record<string, Member>;
  attachments: Attachment[];
  canEdit: boolean;
  isOwner: boolean;
  onOpen: (id: string) => void;
  onAdd: (columnId: string) => void;
  onMove: (id: string, columnId: string, order: number) => void;
  onDragState: (dragging: boolean) => void;
  columnActions: ColumnActions;
}

const sortTasks = (a: Task, b: Task) => a.order - b.order || (a.start ?? "9").localeCompare(b.start ?? "9");

/** The column a task shows in. Tasks from before custom columns fall back to the first column of their status. */
export function columnOf(task: Task, columns: Column[]): string | undefined {
  if (task.columnId && columns.some((c) => c.id === task.columnId)) return task.columnId;
  return (columns.find((c) => c.category === task.status) ?? columns[0])?.id;
}

export function Board({ columns, tasks, hasAny, members, attachments, canEdit, isOwner, onOpen, onAdd, onMove, onDragState, columnActions }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
  const t0 = today();
  const fileCount = useMemo(() => {
    const m: Record<string, number> = {};
    attachments.forEach((a) => (m[a.taskId] = (m[a.taskId] ?? 0) + 1));
    return m;
  }, [attachments]);

  const lanes = useMemo(
    () => columns.map((c) => ({ ...c, items: tasks.filter((t) => columnOf(t, columns) === c.id).sort(sortTasks) })),
    [columns, tasks]
  );

  if (!hasAny && columns.length) {
    return (
      <div className="state">
        <h3>No tasks yet</h3>
        <p>Add a task, or ask the AI agent to draft a plan from a goal.</p>
        {canEdit && (
          <button type="button" className="btn primary" onClick={() => onAdd(columns.find((c) => c.category === "todo")?.id ?? columns[0].id)}>
            Add the first task
          </button>
        )}
      </div>
    );
  }

  const indexAt = (list: HTMLElement, y: number) => {
    const cards = [...list.querySelectorAll<HTMLElement>(".card:not(.dragging)")];
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? cards.length : i;
  };

  const endDrag = () => {
    setDragId(null);
    setOver(null);
    onDragState(false);
  };

  const drop = (e: DragEvent<HTMLDivElement>, colId: string) => {
    e.preventDefault();
    const id = dragId;
    const index = indexAt(e.currentTarget, e.clientY);
    endDrag();
    if (!id) return;
    const lane = lanes.find((c) => c.id === colId)!.items.filter((t) => t.id !== id);
    const prev = lane[index - 1]?.order;
    const next = lane[index]?.order;
    const order = prev === undefined && next === undefined ? 1000 : prev === undefined ? next! - 1000 : next === undefined ? prev + 1000 : (prev + next) / 2;
    const cur = tasks.find((t) => t.id === id);
    if (cur && (columnOf(cur, columns) !== colId || cur.order !== order)) onMove(id, colId, order);
  };

  let visibleIndex = 0;
  return (
    <div className="board">
      {lanes.map((col, ci) => {
        visibleIndex = 0;
        const dropCount = col.items.filter((t) => t.id !== dragId).length;
        return (
          <section key={col.id} className="col" style={{ ["--c" as string]: `var(--s-${col.category})` }} aria-label={col.name}>
            <ColumnHeader
              column={col}
              count={col.items.length}
              columns={columns}
              first={ci === 0}
              last={ci === lanes.length - 1}
              canEdit={canEdit}
              isOwner={isOwner}
              actions={columnActions}
              prevId={ci >= 2 ? lanes[ci - 2].id : null}
              nextId={ci < lanes.length - 1 ? lanes[ci + 1].id : null}
            />
            <div
              className={`list${over?.col === col.id ? " over" : ""}`}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                const index = indexAt(e.currentTarget, e.clientY);
                if (over?.col !== col.id || over.index !== index) setOver({ col: col.id, index });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => drop(e, col.id)}
            >
              {col.items.length === 0 && over?.col !== col.id && <p className="col-empty">{canEdit ? "Drop a task here." : "No tasks."}</p>}
              {col.items.map((t) => {
                const vi = t.id === dragId ? -1 : visibleIndex++;
                return (
                  <div key={t.id} className="card-slot">
                    {vi >= 0 && over?.col === col.id && over.index === vi && <div className="drop-ind" />}
                    <Card
                      task={t}
                      t0={t0}
                      member={t.assigneeId ? members[t.assigneeId] : undefined}
                      files={fileCount[t.id] ?? 0}
                      canEdit={canEdit}
                      dragging={dragId === t.id}
                      done={col.category === "done"}
                      onOpen={() => onOpen(t.id)}
                      onDragStart={() => {
                        setDragId(t.id);
                        onDragState(true);
                      }}
                      onDragEnd={endDrag}
                    />
                  </div>
                );
              })}
              {over?.col === col.id && over.index >= dropCount && <div className="drop-ind" />}
            </div>
            {canEdit && (
              <button type="button" className="btn sm col-add" onClick={() => onAdd(col.id)}>
                <Icon name="plus" size={14} /> Add task
              </button>
            )}
          </section>
        );
      })}
      {canEdit && <AddColumn onAdd={columnActions.add} count={columns.length} />}
    </div>
  );
}

function ColumnHeader({
  column,
  count,
  columns,
  first,
  last,
  canEdit,
  isOwner,
  actions,
  prevId,
  nextId
}: {
  column: Column;
  count: number;
  columns: Column[];
  first: boolean;
  last: boolean;
  canEdit: boolean;
  isOwner: boolean;
  actions: ColumnActions;
  prevId: string | null;
  nextId: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const others = columns.filter((c) => c.id !== column.id);
  const [moveTo, setMoveTo] = useState<string>(others[0]?.id ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setName(column.name), [column.name]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && (setMenu(false), setDeleting(false));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setMenu(false), setDeleting(false));
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const commit = () => {
    setEditing(false);
    const v = name.trim();
    if (v && v !== column.name) actions.rename(column.id, v);
    else setName(column.name);
  };

  return (
    <div className="col-h" ref={ref}>
      <span className="dot" title={CATEGORY_LABELS[column.category]} />
      {editing ? (
        <input
          className="col-name-input"
          value={name}
          maxLength={40}
          autoFocus
          aria-label="Column name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setName(column.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h2 onDoubleClick={() => canEdit && setEditing(true)} title={canEdit ? "Double-click to rename" : undefined}>
          {column.name}
        </h2>
      )}
      <span className="count">{count}</span>
      <span className="grow" />
      {canEdit && (
        <button type="button" className="icon-btn col-menu-btn" aria-label={`Column options for ${column.name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Icon name="dots" size={16} />
        </button>
      )}
      {menu && (
        <div className="popover" role="menu">
          {!deleting ? (
            <>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), setEditing(true))}>
                Rename
              </button>
              <label className="pop-field">
                <span className="lbl">Means</span>
                <select value={column.category} onChange={(e) => actions.setCategory(column.id, e.target.value as Status)}>
                  {STATUS_IDS.map((s) => (
                    <option key={s} value={s}>
                      {CATEGORY_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" role="menuitem" disabled={first} onClick={() => (setMenu(false), actions.moveAfter(column.id, prevId))}>
                Move left
              </button>
              <button type="button" role="menuitem" disabled={last} onClick={() => (setMenu(false), actions.moveAfter(column.id, nextId))}>
                Move right
              </button>
              {isOwner && (
                <button type="button" role="menuitem" className="danger" disabled={!others.length} onClick={() => setDeleting(true)}>
                  Delete column
                </button>
              )}
            </>
          ) : (
            <div className="pop-delete">
              <p>
                Delete <b>{column.name}</b>?
              </p>
              {count > 0 && (
                <label className="pop-field">
                  <span className="lbl">Move its {count} {count === 1 ? "task" : "tasks"} to</span>
                  <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    {others.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="row-wrap">
                <button type="button" className="btn sm ghost" onClick={() => setDeleting(false)}>
                  Cancel
                </button>
                <button type="button" className="btn sm danger armed" onClick={() => (setMenu(false), setDeleting(false), actions.remove(column.id, count > 0 ? moveTo : null))}>
                  Delete column
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddColumn({ onAdd, count }: { onAdd: (name: string, category: Status) => void; count: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Status>("doing");
  if (count >= 12) return null;
  if (!open) {
    return (
      <button type="button" className="col-new" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> Add column
      </button>
    );
  }
  return (
    <form
      className="col-new-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim(), category);
        setName("");
        setOpen(false);
      }}
    >
      <label className="field">
        <span className="lbl">Column name</span>
        <input autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: QA" />
      </label>
      <label className="field">
        <span className="lbl">Means</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Status)}>
          {STATUS_IDS.map((s) => (
            <option key={s} value={s}>
              {CATEGORY_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <div className="row-wrap">
        <button type="submit" className="btn primary sm" disabled={!name.trim()}>
          Add column
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Card({
  task: t,
  t0,
  member,
  files,
  canEdit,
  dragging,
  done,
  onOpen,
  onDragStart,
  onDragEnd
}: {
  task: Task;
  t0: string;
  member?: Member;
  files: number;
  canEdit: boolean;
  dragging: boolean;
  done: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const late = !!t.end && t.status !== "done" && t.end < t0;
  return (
    <div
      className={`card${done ? " done" : ""}${dragging ? " dragging" : ""}`}
      role="button"
      tabIndex={0}
      draggable={canEdit}
      aria-label={t.title}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="card-top">
        <span className="phase">{t.phase || "No phase"}</span>
        <span className={`chip prio-${t.priority}`}>{PRIORITIES[t.priority]}</span>
      </div>
      <div className="card-title">{t.title}</div>
      <div className="card-foot">
        <span className={`dates${late ? " late" : ""}`}>{fmtRange(t.start, t.end)}</span>
        {t.start && t.end && (
          <span className="wd" title="Work days, Monday to Friday">
            {workDays(t.start, t.end)} wd
          </span>
        )}
        {late && <span className="chip late-chip">Late</span>}
        <span className="grow" />
        {files > 0 && (
          <span className="files" title={`${files} ${files === 1 ? "file" : "files"}`}>
            <Icon name="clip" size={14} />
            {files}
          </span>
        )}
        {member && <Avatar id={member.userId} name={member.name || member.email} />}
      </div>
    </div>
  );
}
