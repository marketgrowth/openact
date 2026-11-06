import { useEffect, useMemo, useState, type DragEvent } from "react";
import { CATEGORY_LABELS, PRIORITIES, STATUS_IDS, type Attachment, type Column, type Member, type Status, type Task } from "../../shared/types";
import { fmtRange, today, workDays } from "@openact/ui";
import { Avatar, Icon } from "@openact/ui";
import { EmptyState } from "../pages/Projects";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Badge } from "@openact/ui/components/badge";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@openact/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@openact/ui/components/alert-dialog";
import { cn } from "@openact/ui/lib/utils";

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

  const lanes = useMemo(() => columns.map((c) => ({ ...c, items: tasks.filter((t) => columnOf(t, columns) === c.id).sort(sortTasks) })), [columns, tasks]);

  if (!hasAny && columns.length) {
    return (
      <EmptyState title="No tasks yet" text="Add a task, or ask the AI agent to draft a plan from a goal.">
        {canEdit && <Button onClick={() => onAdd(columns.find((c) => c.category === "todo")?.id ?? columns[0].id)}>Add the first task</Button>}
      </EmptyState>
    );
  }

  const indexAt = (list: HTMLElement, y: number) => {
    const cards = [...list.querySelectorAll<HTMLElement>("[data-card]:not([data-dragging])")];
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
  const dropLine = <div className="h-0.5 rounded-full bg-primary" aria-hidden="true" />;
  return (
    <div className="-mx-4 flex items-start gap-3 overflow-x-auto px-4 pb-4 lg:-mx-6 lg:px-6" data-board="">
      {lanes.map((col, ci) => {
        visibleIndex = 0;
        const dropCount = col.items.filter((t) => t.id !== dragId).length;
        return (
          <section key={col.id} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2" aria-label={col.name} data-column="">
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
              className={cn("flex min-h-16 flex-col gap-2 rounded-lg transition-colors", over?.col === col.id && "bg-accent/60")}
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
              data-list=""
            >
              {col.items.length === 0 && over?.col !== col.id && (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                  {canEdit ? "Drop a task here." : "No tasks."}
                </p>
              )}
              {col.items.map((t) => {
                const vi = t.id === dragId ? -1 : visibleIndex++;
                return (
                  <div key={t.id} className="contents">
                    {vi >= 0 && over?.col === col.id && over.index === vi && dropLine}
                    <TaskCard
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
              {over?.col === col.id && over.index >= dropCount && dropLine}
            </div>
            {canEdit && (
              <Button type="button" variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => onAdd(col.id)}>
                <Icon name="plus" /> Add task
              </Button>
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
  const [deleting, setDeleting] = useState(false);
  const others = columns.filter((c) => c.id !== column.id);
  const [moveTo, setMoveTo] = useState<string>(others[0]?.id ?? "");

  useEffect(() => setName(column.name), [column.name]);

  const commit = () => {
    setEditing(false);
    const v = name.trim();
    if (v && v !== column.name) actions.rename(column.id, v);
    else setName(column.name);
  };

  return (
    <div className="flex h-8 items-center gap-2 px-1" data-column-head="">
      <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--s-${column.category})` }} title={CATEGORY_LABELS[column.category]} />
      {editing ? (
        <Input
          className="h-7 px-2 text-sm"
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
        <h2 className="truncate text-sm font-medium" onDoubleClick={() => canEdit && setEditing(true)} title={canEdit ? "Double-click to rename" : undefined}>
          {column.name}
        </h2>
      )}
      <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 tabular">
        {count}
      </Badge>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7 text-muted-foreground"
              aria-label={`Column options for ${column.name}`}
              data-column-menu=""
            >
              <Icon name="dots" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => setEditing(true)}>Rename</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Means</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel className="text-xs text-muted-foreground">What this column means</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={column.category} onValueChange={(v) => actions.setCategory(column.id, v as Status)}>
                  {STATUS_IDS.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {CATEGORY_LABELS[s]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={first} onSelect={() => actions.moveAfter(column.id, prevId)}>
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={() => actions.moveAfter(column.id, nextId)}>
              Move right
            </DropdownMenuItem>
            {isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!others.length} onSelect={() => setDeleting(true)}>
                  Delete column
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the {column.name} column?</AlertDialogTitle>
            <AlertDialogDescription>
              {count > 0 ? "Its tasks move to another column. No task is deleted." : "The column is empty. No task is deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {count > 0 && (
            <div className="grid gap-2">
              <label htmlFor={`move-${column.id}`} className="text-sm font-medium">
                Move its {count} {count === 1 ? "task" : "tasks"} to
              </label>
              <NativeSelect id={`move-${column.id}`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {others.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => actions.remove(column.id, count > 0 ? moveTo : null)}>
              Delete column
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <Button type="button" variant="outline" className="w-72 shrink-0 border-dashed text-muted-foreground" onClick={() => setOpen(true)}>
        <Icon name="plus" /> Add column
      </Button>
    );
  }
  return (
    <form
      className="grid w-72 shrink-0 gap-3 rounded-xl border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim(), category);
        setName("");
        setOpen(false);
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="new-col-name" className="text-xs font-medium">
          Column name
        </label>
        <Input
          id="new-col-name"
          className="h-8"
          autoFocus
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="For example: QA"
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="new-col-means" className="text-xs font-medium">
          Means
        </label>
        <NativeSelect id="new-col-means" size="sm" value={category} onChange={(e) => setCategory(e.target.value as Status)} className="w-full">
          {STATUS_IDS.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {CATEGORY_LABELS[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!name.trim()}>
          Add column
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const PRIORITY_CLASS: Record<string, string> = {
  high: "text-priority-high border-priority-high/30",
  med: "text-priority-med border-priority-med/30",
  low: "text-priority-low"
};

function TaskCard({
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
      className={cn(
        "grid cursor-pointer gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-[box-shadow,border-color] outline-none hover:border-foreground/20 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        dragging && "opacity-40",
        done && "opacity-70"
      )}
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
      data-card=""
      data-dragging={dragging || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{t.phase || "No phase"}</span>
        <Badge variant="outline" className={cn("h-5 px-1.5 text-[11px]", PRIORITY_CLASS[t.priority])}>
          {PRIORITIES[t.priority]}
        </Badge>
      </div>
      <div className={cn("text-sm leading-snug font-medium", done && "line-through decoration-muted-foreground/50")} data-card-title="">
        {t.title}
      </div>
      <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("tabular", late && "font-medium text-priority-high")}>{fmtRange(t.start, t.end)}</span>
        {t.start && t.end && (
          <span className="tabular" title="Work days, Monday to Friday">
            {workDays(t.start, t.end)} wd
          </span>
        )}
        {late && (
          <Badge variant="destructive" className="h-5 px-1.5 text-[11px]">
            Late
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-2">
          {files > 0 && (
            <span className="flex items-center gap-0.5 tabular" title={`${files} ${files === 1 ? "file" : "files"}`}>
              <Icon name="clip" size={13} />
              {files}
            </span>
          )}
          {member && <Avatar id={member.userId} name={member.name || member.email} size={20} />}
        </span>
      </div>
    </div>
  );
}
