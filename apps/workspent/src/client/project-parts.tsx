import { useEffect, useState, type FormEvent } from "react";
import { Field, Modal, Notice, api, errorText } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { cn } from "@openact/ui/lib/utils";
import { STATUS_TEXT, clockText, minutesFrom, type ClientInfo, type EntryInfo, type ProjectInfo, type TaskInfo, type WeekStatus } from "../shared/projects";
import { companyApi } from "./lib";

/* Parts that the Projects pages share: the date today, status badges, project labels and the time entry form. */

/** Today's date on this device, YYYY-MM-DD. */
export const localToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const STATUS_CLASS: Record<WeekStatus | "open" | "empty", string> = {
  open: "",
  empty: "",
  sent: "border-warn-border bg-warn text-warn-foreground",
  approved: "border-status-done/30 bg-status-done/10 text-status-done",
  returned: "border-destructive/30 bg-destructive/10 text-destructive"
};

export function StatusBadge({ status, label }: { status: WeekStatus | "open" | "empty"; label?: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_CLASS[status])}>
      {label ?? (status === "empty" ? "No hours" : STATUS_TEXT[status])}
    </Badge>
  );
}

/** "Harbor Legal · Website refresh", or the project name alone. */
export function projectLabel(p: Pick<ProjectInfo, "name" | "clientId">, clients: ClientInfo[]): string {
  const c = p.clientId ? clients.find((x) => x.id === p.clientId) : null;
  return c ? `${c.name} · ${p.name}` : p.name;
}

export function useTasks(companyId: string | null, projectId: string): TaskInfo[] {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  useEffect(() => {
    setTasks([]);
    if (!companyId || !projectId) return;
    let live = true;
    api<{ tasks: TaskInfo[] }>(`${companyApi(companyId)}/projects/${projectId}/tasks`).then(
      (r) => live && setTasks(r.tasks),
      () => live && setTasks([])
    );
    return () => {
      live = false;
    };
  }, [companyId, projectId]);
  return tasks;
}

export function ProjectSelect({
  id,
  value,
  onChange,
  projects,
  clients
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  projects: ProjectInfo[];
  clients: ClientInfo[];
}) {
  const sorted = [...projects].sort((a, b) => projectLabel(a, clients).localeCompare(projectLabel(b, clients)));
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
      <NativeSelectOption value="">Pick a project</NativeSelectOption>
      {sorted.map((p) => (
        <NativeSelectOption key={p.id} value={p.id}>
          {projectLabel(p, clients)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function TaskSelect({ id, value, onChange, tasks }: { id: string; value: string; onChange: (v: string) => void; tasks: TaskInfo[] }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full" disabled={!tasks.length}>
      <NativeSelectOption value="">{tasks.length ? "No task" : "This project has no tasks"}</NativeSelectOption>
      {tasks.map((t) => (
        <NativeSelectOption key={t.id} value={t.id}>
          {t.done ? `${t.title} (done)` : t.title}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Add time for a day, or change an entry. Time is typed as 1:30, 1.5 or 90m. */
export function EntryDialog({
  companyId,
  entry,
  date,
  projects,
  clients,
  onClose,
  onSaved
}: {
  companyId: string;
  entry: EntryInfo | null;
  date: string;
  projects: ProjectInfo[];
  clients: ClientInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState(entry?.projectId ?? "");
  const [taskId, setTaskId] = useState(entry?.taskId ?? "");
  const [day, setDay] = useState(entry?.date ?? date);
  const [time, setTime] = useState(entry ? clockText(entry.minutes) : "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tasks = useTasks(companyId, projectId);
  const project = projects.find((p) => p.id === projectId);
  const running = !!entry?.timerStartedAt;

  async function save(e: FormEvent) {
    e.preventDefault();
    const minutes = running ? undefined : minutesFrom(time);
    if (!projectId) return setError("Pick a project.");
    if (!running && !minutes) return setError("Enter the time as 1:30, 1.5 or 90m.");
    setBusy(true);
    setError(null);
    try {
      const body = {
        projectId,
        taskId: taskId || null,
        date: running ? undefined : day,
        minutes,
        note,
        billable
      };
      if (entry)
        await api(`${companyApi(companyId)}/entries/${entry.id}`, {
          method: "PATCH",
          body
        });
      else await api(`${companyApi(companyId)}/entries`, { method: "POST", body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry) return;
    setBusy(true);
    try {
      await api(`${companyApi(companyId)}/entries/${entry.id}`, {
        method: "DELETE"
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  // A project from an older entry may be hidden now (not tracked). Keep it in the list for this entry.
  const choices =
    entry && !projects.some((p) => p.id === entry.projectId)
      ? [
          ...projects,
          {
            id: entry.projectId,
            name: entry.projectName,
            color: "",
            clientId: entry.clientId,
            rateCents: null,
            budgetMinutes: null,
            isBillable: true,
            isTracked: true,
            usedMinutes: 0
          }
        ]
      : projects;

  return (
    <Modal title={entry ? "Change time" : "Add time"} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Project" htmlFor="ws-entry-project">
          <ProjectSelect id="ws-entry-project" value={projectId} onChange={(v) => (setProjectId(v), setTaskId(""))} projects={choices} clients={clients} />
        </Field>
        <Field label="Task (optional)" htmlFor="ws-entry-task">
          <TaskSelect id="ws-entry-task" value={taskId} onChange={setTaskId} tasks={tasks} />
        </Field>
        {!running && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="ws-entry-date">
              <Input id="ws-entry-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
            </Field>
            <Field label="Time" htmlFor="ws-entry-time" help="Such as 1:30, 1.5 or 90m.">
              <Input id="ws-entry-time" inputMode="decimal" value={time} onChange={(e) => setTime(e.target.value)} placeholder="1:30" required />
            </Field>
          </div>
        )}
        <Field label="What did you work on?" htmlFor="ws-entry-note">
          <Input id="ws-entry-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={billable && (project?.isBillable ?? true)} disabled={project ? !project.isBillable : false} onCheckedChange={(v) => setBillable(v === true)} />
          Billable
          {project && !project.isBillable ? ": this project is not billable" : ""}
        </label>
        <div className="flex flex-wrap justify-between gap-2">
          {entry ? (
            <Button type="button" variant="ghost" onClick={remove} disabled={busy || running}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
