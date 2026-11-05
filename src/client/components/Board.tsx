import { useMemo, useState, type DragEvent } from "react";
import { PRIORITIES, STATUSES, type Attachment, type Member, type Status, type Task } from "../../shared/types";
import { fmtRange, today, workDays } from "../dates";
import { Avatar, Icon } from "../ui";

interface Props {
  tasks: Task[];
  hasAny: boolean;
  members: Record<string, Member>;
  attachments: Attachment[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onAdd: (status: Status) => void;
  onMove: (id: string, status: Status, order: number) => void;
  onDragState: (dragging: boolean) => void;
}

const sortTasks = (a: Task, b: Task) => a.order - b.order || (a.start ?? "9") .localeCompare(b.start ?? "9");

export function Board({ tasks, hasAny, members, attachments, canEdit, onOpen, onAdd, onMove, onDragState }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: Status; index: number } | null>(null);
  const t0 = today();
  const fileCount = useMemo(() => {
    const m: Record<string, number> = {};
    attachments.forEach((a) => (m[a.taskId] = (m[a.taskId] ?? 0) + 1));
    return m;
  }, [attachments]);

  const columns = useMemo(
    () => STATUSES.map((s) => ({ ...s, items: tasks.filter((t) => t.status === s.id).sort(sortTasks) })),
    [tasks]
  );

  if (!hasAny) {
    return (
      <div className="state">
        <h3>No tasks yet</h3>
        <p>Add a task, or use AI assist to draft a plan from a goal.</p>
        {canEdit && (
          <button type="button" className="btn primary" onClick={() => onAdd("todo")}>
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

  const drop = (e: DragEvent<HTMLDivElement>, status: Status) => {
    e.preventDefault();
    const id = dragId;
    const index = indexAt(e.currentTarget, e.clientY);
    endDrag();
    if (!id) return;
    const col = columns.find((c) => c.id === status)!.items.filter((t) => t.id !== id);
    const prev = col[index - 1]?.order;
    const next = col[index]?.order;
    const order = prev === undefined && next === undefined ? 1000 : prev === undefined ? next! - 1000 : next === undefined ? prev + 1000 : (prev + next) / 2;
    const cur = tasks.find((t) => t.id === id);
    if (cur && (cur.status !== status || cur.order !== order)) onMove(id, status, order);
  };

  let visibleIndex = 0;
  return (
    <div className="board">
      {columns.map((col) => {
        visibleIndex = 0;
        return (
        <section key={col.id} className="col" style={{ ["--c" as string]: `var(--s-${col.id})` }} aria-label={col.label}>
          <div className="col-h">
            <span className="dot" />
            <h2>{col.label}</h2>
            <span className="count">{col.items.length}</span>
          </div>
          <div
            className={`list${over?.status === col.id ? " over" : ""}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              const index = indexAt(e.currentTarget, e.clientY);
              if (over?.status !== col.id || over.index !== index) setOver({ status: col.id, index });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => drop(e, col.id)}
          >
            {col.items.length === 0 && over?.status !== col.id && <p className="col-empty">{canEdit ? "Drop a task here." : "No tasks."}</p>}
            {col.items.map((t) => {
              // The dragged card stays in place (faded), so its position does not count for the drop index.
              const vi = t.id === dragId ? -1 : visibleIndex++;
              return (
                <FragmentWithIndicator key={t.id} show={vi >= 0 && over?.status === col.id && over.index === vi}>
                  <Card
                    task={t}
                    t0={t0}
                    member={t.assigneeId ? members[t.assigneeId] : undefined}
                    files={fileCount[t.id] ?? 0}
                    canEdit={canEdit}
                    dragging={dragId === t.id}
                    onOpen={() => onOpen(t.id)}
                    onDragStart={() => {
                      setDragId(t.id);
                      onDragState(true);
                    }}
                    onDragEnd={endDrag}
                  />
                </FragmentWithIndicator>
              );
            })}
            {over?.status === col.id && over.index >= col.items.filter((t) => t.id !== dragId).length && <div className="drop-ind" />}
          </div>
          {canEdit && (
            <button type="button" className="btn sm col-add" onClick={() => onAdd(col.id)}>
              <Icon name="plus" size={14} /> Add task
            </button>
          )}
        </section>
        );
      })}
    </div>
  );
}

function FragmentWithIndicator({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <>
      {show && <div className="drop-ind" />}
      {children}
    </>
  );
}

function Card({
  task: t,
  t0,
  member,
  files,
  canEdit,
  dragging,
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
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const late = !!t.end && t.status !== "done" && t.end < t0;
  return (
    <div
      className={`card${t.status === "done" ? " done" : ""}${dragging ? " dragging" : ""}`}
      role="button"
      tabIndex={0}
      draggable={canEdit}
      aria-label={`${t.title}. ${STATUSES.find((s) => s.id === t.status)?.label}.`}
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
