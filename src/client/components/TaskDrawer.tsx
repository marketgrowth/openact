import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_ATTACHMENT_BYTES,
  PRIORITIES,
  STATUSES,
  type Attachment,
  type Member,
  type Priority,
  type Status,
  type Task,
  type TaskInput
} from "../../shared/types";
import { dn, fmtDateTime, fmtSize, isoWeek, workDays } from "../dates";
import { ConfirmButton, Icon, useToast } from "../ui";

export type DrawerTarget = { kind: "new"; status: Status; start?: string; end?: string } | { kind: "edit"; id: string };

interface Props {
  target: DrawerTarget;
  task: Task | null;
  tasks: Task[];
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
  status: Status;
  priority: Priority;
  phase: string;
  start: string;
  end: string;
  assigneeId: string;
  notes: string;
}

const fromTask = (t: Task | null, status: Status, preset?: { start?: string; end?: string }): Form => ({
  title: t?.title ?? "",
  status: t?.status ?? status,
  priority: t?.priority ?? "med",
  phase: t?.phase ?? "",
  start: t?.start ?? preset?.start ?? "",
  end: t?.end ?? preset?.end ?? preset?.start ?? "",
  assigneeId: t?.assigneeId ?? "",
  notes: t?.notes ?? ""
});

export function TaskDrawer({ target, task, tasks, members, attachments, canEdit, onClose, onSave, onDelete, onUpload, onDeleteAttachment }: Props) {
  const toast = useToast();
  const isNew = target.kind === "new";
  const [form, setForm] = useState<Form>(() => fromTask(task, isNew ? target.status : "todo", isNew ? target : undefined));
  const [dirty, setDirty] = useState(false);
  const [base, setBase] = useState(task?.updatedAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const gone = !isNew && !task;
  const changedElsewhere = !isNew && !!task && task.updatedAt !== base;

  // Someone else saved this task. If there are no local edits, show their version.
  useEffect(() => {
    if (changedElsewhere && !dirty && task) {
      setForm(fromTask(task, task.status));
      setBase(task.updatedAt);
    }
  }, [changedElsewhere, dirty, task]);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    window.setTimeout(() => (canEdit ? titleRef.current?.focus() : null), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener.current?.focus?.();
    };
  }, [canEdit, onClose]);

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
      status: form.status,
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

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <form onSubmit={submit}>
          <div className="d-head">
            <h2 id="drawer-title">{isNew ? "New task" : canEdit ? "Edit task" : "Task"}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div className="d-body">
            {gone && <p className="note">Someone deleted this task.</p>}
            {changedElsewhere && dirty && <p className="note">Someone else changed this task. Save to keep your version, or cancel to see theirs.</p>}
            <fieldset className="stack plain" disabled={!canEdit || gone}>
              <div className="field">
                <label htmlFor="f-title">Title</label>
                <input id="f-title" ref={titleRef} maxLength={140} value={form.title} onChange={(e) => set("title", e.target.value)} autoComplete="off" />
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="f-status">Status</label>
                  <select id="f-status" value={form.status} onChange={(e) => set("status", e.target.value as Status)}>
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="f-priority">Priority</label>
                  <select id="f-priority" value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                    {(Object.keys(PRIORITIES) as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITIES[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-phase">Phase</label>
                <input id="f-phase" list="f-phases" maxLength={60} value={form.phase} placeholder="For example: Design" onChange={(e) => set("phase", e.target.value)} autoComplete="off" />
                <datalist id="f-phases">
                  {phases.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="f-start">Start</label>
                  <input id="f-start" type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="f-end">End</label>
                  <input id="f-end" type="date" value={form.end} onChange={(e) => set("end", e.target.value)} />
                </div>
              </div>
              <p className="hint">{dateInfo}</p>
              <div className="field">
                <label htmlFor="f-assignee">Assignee</label>
                <select id="f-assignee" value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-notes">Notes</label>
                <textarea id="f-notes" rows={5} maxLength={8000} value={form.notes} placeholder="Add details, links or acceptance criteria." onChange={(e) => set("notes", e.target.value)} />
              </div>
            </fieldset>

            {!isNew && task && (
              <section className="files-block" aria-label="Files">
                <div className="files-head">
                  <span className="lbl">Files</span>
                  {canEdit && (
                    <>
                      <input ref={fileRef} id="f-file" type="file" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
                      <label htmlFor="f-file" className={`btn sm${uploading ? " is-busy" : ""}`}>
                        <Icon name="clip" size={14} /> {uploading ? "Uploading…" : "Attach a file"}
                      </label>
                    </>
                  )}
                </div>
                {files.length === 0 ? (
                  <p className="hint">No files. The limit is 25 MB per file.</p>
                ) : (
                  <ul className="file-list">
                    {files.map((f) => (
                      <li key={f.id}>
                        <a href={`/api/attachments/${f.id}`} className="file-link" download={f.filename}>
                          <Icon name="download" size={15} />
                          <span className="file-name">{f.filename}</span>
                          <span className="file-size">{fmtSize(f.size)}</span>
                        </a>
                        {canEdit && (
                          <button type="button" className="icon-btn" aria-label={`Remove ${f.filename}`} onClick={() => onDeleteAttachment(f.id)}>
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {task?.updatedAt && (
              <p className="hint meta">
                Last change by {editedBy ? editedBy.name || editedBy.email : "a former member"}, {fmtDateTime(task.updatedAt)}.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="d-foot">
            {canEdit && !isNew && task && <ConfirmButton label="Delete" confirmLabel="Click again to delete" onConfirm={() => { onDelete(task.id); onClose(); }} />}
            <span className="grow" />
            <button type="button" className="btn ghost" onClick={onClose}>
              {canEdit ? "Cancel" : "Close"}
            </button>
            {canEdit && (
              <button type="submit" className="btn primary" disabled={busy || gone}>
                {isNew ? "Add task" : "Save"}
              </button>
            )}
          </div>
        </form>
      </aside>
    </>
  );
}
