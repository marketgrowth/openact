import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROJECT_COLORS,
  STATUSES,
  type AppConfig,
  type Attachment,
  type ProjectColor,
  type ProjectDetail,
  type Status,
  type Task,
  type TaskInput,
  type User
} from "../../shared/types";
import { api, ApiError, errorText } from "../api";
import { Link, navigate } from "../router";
import { fmtShort, today } from "../dates";
import { ConfirmButton, Icon, Modal, useToast } from "../ui";
import { Board } from "../components/Board";
import { Timeline } from "../components/Timeline";
import { TaskDrawer, type DrawerTarget } from "../components/TaskDrawer";
import { Members } from "../components/Members";
import { AiDialog } from "../components/AiDialog";

type View = "board" | "timeline" | "members";
const POLL_MS = 5000;

export function ProjectPage({ projectId, view, me, config }: { projectId: string; view: View; me: User; config: AppConfig }) {
  const toast = useToast();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const revRef = useRef(0);
  const busyRef = useRef(false); // true while a drag runs, so a reload does not move cards under the pointer

  const load = useCallback(async () => {
    try {
      const d = await api<ProjectDetail>(`/api/projects/${projectId}`);
      revRef.current = d.project.rev;
      setData(d);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setError(e.message);
      else setError(errorText(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Stay in sync with other people: poll a cheap revision number, reload when it changes.
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      try {
        const r = await api<{ rev: number }>(`/api/projects/${projectId}/rev`);
        setOffline(false);
        if (r.rev !== revRef.current) load();
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setError(e.message);
        else setOffline(true);
      }
    };
    const t = window.setInterval(tick, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [projectId, load]);

  const canEdit = data?.role === "owner" || data?.role === "editor";
  const isOwner = data?.role === "owner";
  const setBusy = useCallback((b: boolean) => (busyRef.current = b), []);

  const noteRev = (rev: number) => {
    // Our own change: skip one reload unless someone else also changed the project.
    if (rev === revRef.current + 1) revRef.current = rev;
  };

  const patchLocal = (fn: (d: ProjectDetail) => ProjectDetail) => setData((d) => (d ? fn(d) : d));
  const upsertTask = (t: Task) =>
    patchLocal((d) => ({ ...d, tasks: d.tasks.some((x) => x.id === t.id) ? d.tasks.map((x) => (x.id === t.id ? t : x)) : [...d.tasks, t] }));

  const fail = (e: unknown) => {
    toast(errorText(e));
    load();
  };

  const saveTask = async (id: string | null, input: TaskInput): Promise<Task | null> => {
    try {
      const r = id
        ? await api<{ task: Task; rev: number }>(`/api/tasks/${id}`, { method: "PATCH", body: input })
        : await api<{ task: Task; rev: number }>(`/api/projects/${projectId}/tasks`, { body: input });
      noteRev(r.rev);
      upsertTask(r.task);
      toast(id ? "Saved." : "Task added.");
      return r.task;
    } catch (e) {
      toast(errorText(e));
      return null;
    }
  };

  const quickPatch = async (id: string, input: TaskInput, msg?: string) => {
    const cur = data?.tasks.find((t) => t.id === id);
    if (cur) upsertTask({ ...cur, ...input } as Task);
    try {
      const r = await api<{ task: Task; rev: number }>(`/api/tasks/${id}`, { method: "PATCH", body: input });
      noteRev(r.rev);
      upsertTask(r.task);
      if (msg) toast(msg);
    } catch (e) {
      fail(e);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      const r = await api<{ rev: number }>(`/api/tasks/${id}`, { method: "DELETE" });
      noteRev(r.rev);
      patchLocal((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id), attachments: d.attachments.filter((a) => a.taskId !== id) }));
      toast("Task deleted.");
    } catch (e) {
      fail(e);
    }
  };

  const upload = async (taskId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api<{ attachment: Attachment; rev: number }>(`/api/tasks/${taskId}/attachments`, { form });
      noteRev(r.rev);
      patchLocal((d) => ({ ...d, attachments: [...d.attachments, r.attachment] }));
      toast("File attached.");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const deleteAttachment = async (id: string) => {
    try {
      const r = await api<{ rev: number }>(`/api/attachments/${id}`, { method: "DELETE" });
      noteRev(r.rev);
      patchLocal((d) => ({ ...d, attachments: d.attachments.filter((a) => a.id !== id) }));
      toast("File removed.");
    } catch (e) {
      fail(e);
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.tasks.filter(
      (t) => (!needle || t.title.toLowerCase().includes(needle) || t.phase.toLowerCase().includes(needle)) && (!mine || t.assigneeId === me.id)
    );
  }, [data, q, mine, me.id]);

  const membersById = useMemo(() => Object.fromEntries((data?.members ?? []).map((m) => [m.userId, m])), [data?.members]);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  if (error && !data) {
    return (
      <main className="wrap page">
        <div className="state">
          <h3>This project cannot open</h3>
          <p>{error}</p>
          <Link to="/" className="btn primary">
            Go to your projects
          </Link>
        </div>
      </main>
    );
  }
  if (!data) return <main className="wrap page"><p className="muted">Loading the project…</p></main>;

  const base = `/p/${projectId}`;
  const drawerTask = drawer && drawer.kind === "edit" ? data.tasks.find((t) => t.id === drawer.id) ?? null : null;

  return (
    <>
      <section className={`project-head pc-${data.project.color}`}>
        <div className="wrap ph-in">
          <div className="ph-title">
            <Link to="/" className="back" aria-label="All projects">
              <Icon name="back" size={16} /> Projects
            </Link>
            <h1>{data.project.name}</h1>
            {data.project.description && <p className="muted ph-desc">{data.project.description}</p>}
          </div>
          <nav className="tabs" aria-label="Project views">
            <Link to={base} aria-current={view === "board" ? "page" : undefined}>
              <Icon name="board" size={16} /> Board
            </Link>
            <Link to={`${base}/timeline`} aria-current={view === "timeline" ? "page" : undefined}>
              <Icon name="timeline" size={16} /> Timeline
            </Link>
            <Link to={`${base}/members`} aria-current={view === "members" ? "page" : undefined}>
              <Icon name="users" size={16} /> People <span className="count">{data.members.length}</span>
            </Link>
          </nav>
        </div>
        {view !== "members" && (
          <div className="wrap ph-tools">
            <input type="search" className="filter" placeholder="Filter tasks" aria-label="Filter tasks" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="toggle">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My tasks
            </label>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => setAiOpen(true)}>
              <Icon name="sparkle" size={16} /> AI assist
            </button>
            <button type="button" className="btn ghost icon-only" aria-label="Project settings" title="Project settings" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" size={16} />
            </button>
            {canEdit && (
              <button type="button" className="btn primary" onClick={() => setDrawer({ kind: "new", status: "todo" })}>
                <Icon name="plus" size={16} /> New task
              </button>
            )}
          </div>
        )}
        <div className="wrap">
          <Summary tasks={data.tasks} />
        </div>
      </section>

      <main className="wrap">
        {offline && <div className="notice warn">The server cannot be reached. Changes from others may be out of date.</div>}
        {!canEdit && <div className="notice info">Your role is Viewer. You can see this project. Ask an owner for Editor access to make changes.</div>}

        {view === "board" && (
          <Board
            tasks={visible}
            hasAny={data.tasks.length > 0}
            members={membersById}
            attachments={data.attachments}
            canEdit={canEdit}
            onOpen={(id) => setDrawer({ kind: "edit", id })}
            onAdd={(status: Status) => setDrawer({ kind: "new", status })}
            onMove={(id, status, order) => quickPatch(id, { status, order })}
            onDragState={setBusy}
          />
        )}
        {view === "timeline" && (
          <Timeline
            tasks={visible}
            hasAny={data.tasks.length > 0}
            members={membersById}
            canEdit={canEdit}
            onOpen={(id) => setDrawer({ kind: "edit", id })}
            onReschedule={(id, start, end) => quickPatch(id, { start, end }, `Moved to ${fmtShort(start)}.`)}
            onDragState={setBusy}
            onAdd={() => setDrawer({ kind: "new", status: "todo" })}
          />
        )}
        {view === "members" && <Members data={data} me={me} isOwner={!!isOwner} onChanged={load} />}
      </main>

      {drawer && (
        <TaskDrawer
          target={drawer}
          task={drawerTask}
          tasks={data.tasks}
          members={data.members}
          attachments={data.attachments}
          canEdit={canEdit}
          onClose={closeDrawer}
          onSave={saveTask}
          onDelete={deleteTask}
          onUpload={upload}
          onDeleteAttachment={deleteAttachment}
        />
      )}
      {aiOpen && <AiDialog projectId={projectId} canEdit={canEdit} provider={config.aiProvider} onClose={() => setAiOpen(false)} onAdded={load} />}
      {settingsOpen && (
        <ProjectSettings data={data} me={me} canEdit={canEdit} isOwner={!!isOwner} onClose={() => setSettingsOpen(false)} onSaved={load} />
      )}
    </>
  );
}

function Summary({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return null;
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0])) as Record<Status, number>;
  tasks.forEach((t) => counts[t.status]++);
  const t0 = today();
  const late = tasks.filter((t) => t.end && t.status !== "done" && t.end < t0).length;
  const pct = Math.round((counts.done / tasks.length) * 100);
  const next = tasks.filter((t) => t.end && t.status !== "done" && t.end >= t0).sort((a, b) => (a.end! < b.end! ? -1 : 1))[0];
  return (
    <div className="summary">
      <span className="stack-bar" role="img" aria-label={STATUSES.map((s) => `${s.label} ${counts[s.id]}`).join(", ")}>
        {STATUSES.map((s) =>
          counts[s.id] ? <span key={s.id} style={{ flex: counts[s.id], background: `var(--s-${s.id})` }} title={`${s.label}: ${counts[s.id]}`} /> : null
        )}
      </span>
      <span>
        <b>{tasks.length}</b> {tasks.length === 1 ? "task" : "tasks"}
      </span>
      <span>
        <b>{pct}%</b> done
      </span>
      <span>
        <b>{counts.doing}</b> in progress
      </span>
      {late > 0 && (
        <span className="late">
          <b>{late}</b> late
        </span>
      )}
      {next && (
        <span>
          Next due: <b>{fmtShort(next.end!)}</b> {next.title}
        </span>
      )}
    </div>
  );
}

function ProjectSettings({
  data,
  me,
  canEdit,
  isOwner,
  onClose,
  onSaved
}: {
  data: ProjectDetail;
  me: User;
  canEdit: boolean;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(data.project.name);
  const [description, setDescription] = useState(data.project.description);
  const [color, setColor] = useState<ProjectColor>(data.project.color);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/projects/${data.project.id}`, { method: "PATCH", body: { name, description, color } });
      toast("Project saved.");
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    try {
      await api(`/api/projects/${data.project.id}/members/${me.id}`, { method: "DELETE" });
      toast("You left the project.");
      navigate("/");
    } catch (err) {
      toast(errorText(err));
    }
  };
  const remove = async () => {
    try {
      await api(`/api/projects/${data.project.id}`, { method: "DELETE" });
      toast("Project deleted.");
      navigate("/");
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <Modal title="Project settings" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <fieldset className="stack plain" disabled={!canEdit}>
          <div className="field">
            <label htmlFor="ps-name">Name</label>
            <input id="ps-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ps-desc">Description</label>
            <textarea id="ps-desc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <fieldset className="field">
            <legend className="lbl">Color</legend>
            <div className="swatches">
              {PROJECT_COLORS.map((c) => (
                <label key={c} className={`swatch pc-${c}`} title={c}>
                  <input type="radio" name="ps-color" value={c} checked={color === c} onChange={() => setColor(c)} />
                  <span className="sr-only">{c}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        {canEdit && (
          <div className="row-end">
            <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
              Save
            </button>
          </div>
        )}
      </form>
      <hr />
      <div className="stack">
        <div className="row-wrap">
          <ConfirmButton label="Leave project" confirmLabel="Click again to leave" onConfirm={leave} />
          {isOwner && <ConfirmButton label={<><Icon name="trash" size={16} /> Delete project</>} confirmLabel="Click again to delete everything" onConfirm={remove} />}
        </div>
        {isOwner && <p className="hint">Deleting a project removes its tasks and files for everyone. You cannot undo it.</p>}
      </div>
    </Modal>
  );
}
