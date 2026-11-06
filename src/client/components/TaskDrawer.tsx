import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_ATTACHMENT_BYTES, PRIORITIES, type Attachment, type Column, type Member, type Priority, type Task, type TaskInput } from "../../shared/types";
import { dn, fmtDateTime, fmtSize, isoWeek, workDays } from "../dates";
import { ConfirmButton, Icon, LinkList, Notice, useToast } from "../ui";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RelatedTasks } from "./SearchDialog";
import { columnOf } from "./Board";

export type DrawerTarget = { kind: "new"; columnId?: string; start?: string; end?: string } | { kind: "edit"; id: string };

interface Props {
  target: DrawerTarget;
  task: Task | null;
  tasks: Task[];
  columns: Column[];
  members: Member[];
  attachments: Attachment[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (id: string | null, input: TaskInput) => Promise<Task | null>;
  onDelete: (id: string) => void;
  onUpload: (taskId: string, file: File) => Promise<void>;
  onDeleteAttachment: (id: string) => void;
}

interface Form {
  title: string;
  columnId: string;
  priority: Priority;
  phase: string;
  start: string;
  end: string;
  assigneeId: string;
  notes: string;
}

const fromTask = (t: Task | null, columnId: string, preset?: { start?: string; end?: string }): Form => ({
  title: t?.title ?? "",
  columnId,
  priority: t?.priority ?? "med",
  phase: t?.phase ?? "",
  start: t?.start ?? preset?.start ?? "",
  end: t?.end ?? preset?.end ?? preset?.start ?? "",
  assigneeId: t?.assigneeId ?? "",
  notes: t?.notes ?? ""
});

export function TaskDrawer({ target, task, tasks, columns, members, attachments, canEdit, onClose, onSave, onDelete, onUpload, onDeleteAttachment }: Props) {
  const toast = useToast();
  const isNew = target.kind === "new";
  const fallbackColumn = (columns.find((c) => c.category === "todo") ?? columns[0])?.id ?? "";
  const columnOfTask = (t: Task) => columnOf(t, columns) ?? fallbackColumn;
  const [form, setForm] = useState<Form>(() =>
    fromTask(task, task ? columnOfTask(task) : isNew ? (target.columnId ?? fallbackColumn) : fallbackColumn, isNew ? target : undefined)
  );
  const [dirty, setDirty] = useState(false);
  const [base, setBase] = useState(task?.updatedAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const gone = !isNew && !task;
  const changedElsewhere = !isNew && !!task && task.updatedAt !== base;

  // Someone else saved this task. If there are no local edits, show their version.
  useEffect(() => {
    if (changedElsewhere && !dirty && task) {
      setForm(fromTask(task, columnOfTask(task)));
      setBase(task.updatedAt);
    }
  }, [changedElsewhere, dirty, task]);

  const phases = useMemo(() => [...new Set(tasks.map((t) => t.phase).filter(Boolean))].sort(), [tasks]);
  const files = task ? attachments.filter((a) => a.taskId === task.id) : [];
  const editedBy = task?.updatedBy ? members.find((m) => m.userId === task.updatedBy) : undefined;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "start" && v && (!f.end || f.end < (v as string))) next.end = v as string;
      return next;
    });
    setDirty(true);
    setError(null);
  };

  const dateInfo = (() => {
    const { start: s, end: e } = form;
    if (s && e && e >= s) {
      const w1 = isoWeek(dn(s));
      const w2 = isoWeek(dn(e));
      return `${workDays(s, e)} work days, ${dn(e) - dn(s) + 1} calendar days. Week ${w1}${w1 !== w2 ? ` to week ${w2}` : ""}.`;
    }
    if (s && e) return "The end date is before the start date.";
    return "Leave both dates empty to keep the task off the timeline.";
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || gone) return;
    if (!form.title.trim()) {
      setError("Add a title.");
      titleRef.current?.focus();
      return;
    }
    if (form.start && form.end && form.end < form.start) {
      setError("The end date must be on or after the start date.");
      return;
    }
    setBusy(true);
    const saved = await onSave(isNew ? null : task!.id, {
      title: form.title.trim(),
      columnId: form.columnId,
      priority: form.priority,
      phase: form.phase.trim(),
      start: form.start || null,
      end: form.end || null,
      assigneeId: form.assigneeId || null,
      notes: form.notes
    });
    setBusy(false);
    if (saved) onClose();
  };

  const upload = async (file: File | undefined) => {
    if (!file || !task) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast("The file is too large. The limit is 25 MB.");
      return;
    }
    setUploading(true);
    await onUpload(task.id, file);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const select = "w-full";
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="w-full gap-0 sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // Put the cursor in the title for editors. Viewers start at the close button.
          if (canEdit) {
            e.preventDefault();
            titleRef.current?.focus();
          }
        }}
        data-drawer=""
      >
        <form onSubmit={submit} className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{isNew ? "New task" : canEdit ? "Edit task" : "Task"}</SheetTitle>
            <SheetDescription className="sr-only">{isNew ? "Add a task to the project." : "See and change the task."}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            {gone && <Notice>Someone deleted this task.</Notice>}
            {changedElsewhere && dirty && <Notice>Someone else changed this task. Save to keep your version, or cancel to see theirs.</Notice>}
            <fieldset className="grid gap-4 disabled:opacity-80" disabled={!canEdit || gone}>
              <div className="grid gap-2">
                <Label htmlFor="f-title">Title</Label>
                <Input id="f-title" ref={titleRef} maxLength={140} value={form.title} onChange={(e) => set("title", e.target.value)} autoComplete="off" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="f-column">Column</Label>
                  <NativeSelect id="f-column" className={select} value={form.columnId} onChange={(e) => set("columnId", e.target.value)}>
                    {columns.map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="f-priority">Priority</Label>
                  <NativeSelect id="f-priority" className={select} value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                    {(Object.keys(PRIORITIES) as Priority[]).map((p) => (
                      <NativeSelectOption key={p} value={p}>
                        {PRIORITIES[p]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="f-phase">Phase</Label>
                <Input
                  id="f-phase"
                  list="f-phases"
                  maxLength={60}
                  value={form.phase}
                  placeholder="For example: Design"
                  onChange={(e) => set("phase", e.target.value)}
                  autoComplete="off"
                />
                <datalist id="f-phases">
                  {phases.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="f-start">Start</Label>
                    <Input id="f-start" type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="f-end">End</Label>
                    <Input id="f-end" type="date" value={form.end} onChange={(e) => set("end", e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{dateInfo}</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="f-assignee">Assignee</Label>
                <NativeSelect id="f-assignee" className={select} value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                  <NativeSelectOption value="">Unassigned</NativeSelectOption>
                  {members.map((m) => (
                    <NativeSelectOption key={m.userId} value={m.userId}>
                      {m.name || m.email}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="f-notes">Notes</Label>
                <Textarea
                  id="f-notes"
                  rows={5}
                  maxLength={8000}
                  value={form.notes}
                  placeholder="Add details, links or acceptance criteria."
                  onChange={(e) => set("notes", e.target.value)}
                />
                <LinkList text={form.notes} label="Links in the notes" />
              </div>
            </fieldset>

            {!isNew && task && <RelatedTasks taskId={task.id} />}

            {!isNew && task && (
              <section className="grid gap-2" aria-label="Files">
                <Separator />
                <div className="flex items-center justify-between gap-2 pt-2">
                  <span className="text-sm font-medium">Files</span>
                  {canEdit && (
                    <>
                      <input ref={fileRef} id="f-file" type="file" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
                      <Button asChild variant="outline" size="sm" aria-busy={uploading}>
                        <label htmlFor="f-file" className="cursor-pointer">
                          <Icon name="clip" /> {uploading ? "Uploading…" : "Attach a file"}
                        </label>
                      </Button>
                    </>
                  )}
                </div>
                {files.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No files. The limit is 25 MB per file.</p>
                ) : (
                  <ul className="grid gap-1">
                    {files.map((f) => (
                      <li key={f.id} className="flex items-center gap-1 rounded-md border pr-1">
                        <a
                          href={`/api/attachments/${f.id}`}
                          className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-sm hover:underline"
                          download={f.filename}
                        >
                          <Icon name="download" size={14} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">{f.filename}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">{fmtSize(f.size)}</span>
                        </a>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Remove ${f.filename}`}
                            onClick={() => onDeleteAttachment(f.id)}
                          >
                            <Icon name="trash" size={14} />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {task?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Last change by {editedBy ? editedBy.name || editedBy.email : "a former member"}, {fmtDateTime(task.updatedAt)}.
              </p>
            )}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
          <SheetFooter className="flex-row items-center border-t">
            {canEdit && !isNew && task && (
              <ConfirmButton
                label="Delete"
                confirmLabel="Click again to delete"
                onConfirm={() => {
                  onDelete(task.id);
                  onClose();
                }}
              />
            )}
            <span className="flex-1" />
            <Button type="button" variant="outline" onClick={onClose}>
              {canEdit ? "Cancel" : "Close"}
            </Button>
            {canEdit && (
              <Button type="submit" disabled={busy || gone}>
                {isNew ? "Add task" : "Save"}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
