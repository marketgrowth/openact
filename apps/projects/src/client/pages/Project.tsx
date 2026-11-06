import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROJECT_COLORS,
  STATUSES,
  VISIBILITIES,
  VISIBILITY_HELP,
  VISIBILITY_LABELS,
  type Visibility,
  type AppConfig,
  type Attachment,
  type ProjectColor,
  type ProjectDetail,
  type Status,
  type Task,
  type TaskInput,
  type User
} from "../../shared/types";
import { api, ApiError, errorText } from "@openact/ui";
import { Link, navigate } from "@openact/ui";
import { fmtRange, fmtShort, today } from "@openact/ui";
import { Avatar, ConfirmButton, Field, Icon, LinkedText, Modal, Notice, useToast } from "@openact/ui";
import { PageBody, SiteHeader } from "@openact/ui";
import { ChoiceGroup, EmptyState } from "./Projects";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Textarea } from "@openact/ui/components/textarea";
import { Switch } from "@openact/ui/components/switch";
import { Label } from "@openact/ui/components/label";
import { Separator } from "@openact/ui/components/separator";
import { Badge } from "@openact/ui/components/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openact/ui/components/tooltip";
import { cn } from "@openact/ui/lib/utils";
import { useLive, type Viewer } from "@openact/ui";
import { Board, type ColumnActions } from "../components/Board";
import type { DrawerTarget } from "../components/TaskDrawer";
import { useAgent } from "../agui/useAgent";
import type { UiToolHandlers } from "../agui/tools";
import { PROJECT_VIEWS, UI_TOOLS, type OpenActAgentState, type ProjectView } from "../../shared/agui";
import { useWorkspace } from "@openact/ui";
import { onOpenTask, takePendingTask } from "../openTask";
import { useProjects } from "../projects-context";

// Views and panels load on first use, so a project opens with less code.
const named = <K extends string, M extends Record<K, React.ComponentType<any>>>(load: () => Promise<M>, key: K) =>
  lazy(() => load().then((m) => ({ default: m[key] })));
const Timeline = named(() => import("../components/Timeline"), "Timeline");
const Calendar = named(() => import("../components/Calendar"), "Calendar");
const Members = named(() => import("../components/Members"), "Members");
const TaskDrawer = named(() => import("../components/TaskDrawer"), "TaskDrawer");
const AiDialog = named(() => import("../components/AiDialog"), "AiDialog");
const AiSettings = named(() => import("../components/AiSettings"), "AiSettings");

type View = ProjectView;
const POLL_MS = 5000;

/**
 * A request that the scope check sent to another project. The next project page opens its agent with the text filled in.
 * Module state, so it survives in-app navigation and nothing is written to storage.
 */
let pendingHandoff: { projectId: string; text: string; at: number } | null = null;

export function ProjectPage({ projectId, view, me, config }: { projectId: string; view: View; me: User; config: AppConfig }) {
  const toast = useToast();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const ws = useWorkspace();
  const [offline, setOffline] = useState(false);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState("");
  const revRef = useRef(0);
  const busyRef = useRef(false); // true while a drag runs, so a reload does not move cards under the pointer

  const load = useCallback(async () => {
    try {
      const d = await api<ProjectDetail>(`/api/projects/${projectId}`);
      revRef.current = d.project.rev;
      setData(d);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_access") setNoAccess(true);
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        // Access was removed, or the project was deleted. Stop showing old data.
        setData(null);
        setError(e.message);
      } else setError(errorText(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Stay in sync with other people. A WebSocket tells this page when the project changes.
  // While it is down, the page polls a cheap revision number instead.
  const staleRef = useRef(false);
  const onLiveRev = useCallback(
    (rev: number) => {
      if (rev === revRef.current) return;
      if (busyRef.current)
        staleRef.current = true; // Reload after the drag ends.
      else load();
    },
    [load]
  );
  const liveConn = useLive(`/api/projects/${encodeURIComponent(projectId)}/live`, !!data && !noAccess, onLiveRev);
  const liveRef = useRef(false);
  liveRef.current = liveConn.connected;

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible" || busyRef.current || !revRef.current) return;
      if (liveRef.current && !staleRef.current) return;
      staleRef.current = false;
      try {
        const r = await api<{ rev: number }>(`/api/projects/${projectId}/rev`);
        setOffline(false);
        if (r.rev !== revRef.current) load();
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) load();
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

  // The room sends the current revision on every connect, so a reconnect catches missed changes.
  useEffect(() => {
    if (liveConn.connected) setOffline(false);
  }, [liveConn.connected]);

  // Open the agent with a request that another project's agent sent here.
  const loaded = !!data;
  useEffect(() => {
    if (!loaded || !data) return;
    const h = pendingHandoff;
    if (!h || h.projectId !== projectId) return;
    pendingHandoff = null;
    if (Date.now() - h.at > 10 * 60000) return;
    if (data.agentLevel === "off") {
      toast("AI is turned off for your role in this project.");
      return;
    }
    setAiDraft(h.text);
    setAiOpen(true);
  }, [loaded, projectId]);

  // Opening a project from another company makes that company current, so the side panel matches.
  const projectCompany = data?.project.companyId ?? null;
  const { current: currentCompany, companies, switchTo } = ws;
  useEffect(() => {
    if (projectCompany && currentCompany?.id !== projectCompany && companies?.some((c) => c.id === projectCompany)) switchTo(projectCompany);
  }, [projectCompany, currentCompany?.id, companies, switchTo]);

  // Open a task that search asked for: when the project loads, or at once when it is already open.
  useEffect(() => {
    if (!loaded) return;
    const id = takePendingTask(projectId);
    if (id) setDrawer({ kind: "edit", id });
  }, [loaded, projectId]);
  useEffect(() => onOpenTask((pid, id) => pid === projectId && setDrawer({ kind: "edit", id })), [projectId]);

  // Opening a task puts it at the top of the Recent list in the side panel.
  const { noteTaskOpened } = useProjects();
  const openedTaskId = drawer?.kind === "edit" ? drawer.id : null;
  useEffect(() => {
    if (openedTaskId) noteTaskOpened(projectId, openedTaskId);
  }, [openedTaskId, projectId]);

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
    const col = input.columnId ? data?.columns.find((c) => c.id === input.columnId) : undefined;
    if (cur) upsertTask({ ...cur, ...input, ...(col ? { status: col.category } : {}) } as Task);
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
      (t) =>
        (!needle || t.title.toLowerCase().includes(needle) || t.phase.toLowerCase().includes(needle) || t.notes.toLowerCase().includes(needle)) &&
        (!mine || t.assigneeId === me.id)
    );
  }, [data, q, mine, me.id]);

  const membersById = useMemo(() => Object.fromEntries((data?.members ?? []).map((m) => [m.userId, m])), [data?.members]);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const columnRequest = async (fn: () => Promise<{ rev: number }>, msg: string) => {
    try {
      const r = await fn();
      noteRev(r.rev);
      toast(msg);
    } catch (e) {
      toast(errorText(e));
    }
    load();
  };
  const columnActions: ColumnActions = {
    add: (name, category) => columnRequest(() => api(`/api/projects/${projectId}/columns`, { body: { name, category } }), "Column added."),
    rename: (id, name) => columnRequest(() => api(`/api/columns/${id}`, { method: "PATCH", body: { name } }), "Column renamed."),
    setCategory: (id, category) => columnRequest(() => api(`/api/columns/${id}`, { method: "PATCH", body: { category } }), "Column updated."),
    moveAfter: (id, afterId) => columnRequest(() => api(`/api/columns/${id}`, { method: "PATCH", body: { afterColumnId: afterId } }), "Column moved."),
    remove: (id, moveTo) =>
      columnRequest(() => api(`/api/columns/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ""}`, { method: "DELETE" }), "Column deleted.")
  };

  /* AG-UI: the state and tools the web app shares with the project assistant. */
  const base = `/p/${projectId}`;
  const live = useRef({ data, view, q, mine, focusDate, drawer });
  live.current = { data, view, q, mine, focusDate, drawer };

  const getAgentState = useCallback((): OpenActAgentState => {
    const l = live.current;
    return {
      projectId,
      projectName: l.data?.project.name ?? "",
      view: l.view,
      focusDate: l.focusDate,
      openTaskId: l.drawer?.kind === "edit" ? l.drawer.id : null,
      filter: { query: l.q, mine: l.mine },
      today: today()
    };
  }, [projectId]);

  const getAgentContext = useCallback(() => {
    const st = getAgentState();
    const open = st.openTaskId ? live.current.data?.tasks.find((t) => t.id === st.openTaskId) : undefined;
    return [
      { description: "Current view", value: st.view },
      { description: "Person's local date", value: st.today },
      ...(st.focusDate ? [{ description: "Calendar date in focus", value: st.focusDate }] : []),
      ...(open ? [{ description: "Open task", value: `${open.title} [${open.id}]` }] : []),
      ...(st.filter.query || st.filter.mine ? [{ description: "Task filter", value: `text "${st.filter.query}", only mine: ${st.filter.mine}` }] : [])
    ];
  }, [getAgentState]);

  const toolHandlers = useMemo<UiToolHandlers>(
    () => ({
      open_task: (args) => {
        const id = String(args.taskId ?? "");
        const t = live.current.data?.tasks.find((x) => x.id === id);
        if (!t) throw new Error(`There is no task with id ${id}.`);
        setAiOpen(false);
        setDrawer({ kind: "edit", id });
        return `Opened "${t.title}".`;
      },
      show_view: (args) => {
        const v = String(args.view ?? "") as View;
        if (!PROJECT_VIEWS.includes(v)) throw new Error(`Unknown view "${v}". Use one of: ${PROJECT_VIEWS.join(", ")}.`);
        navigate(v === "board" ? base : `${base}/${v}`);
        return `Showing the ${v} view.`;
      },
      go_to_date: (args) => {
        const d = String(args.date ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("The date must look like 2026-11-05.");
        setFocusDate(d);
        navigate(`${base}/calendar`);
        return `Showing ${d} on the calendar.`;
      },
      filter_tasks: (args) => {
        if (typeof args.query === "string") setQ(args.query);
        if (typeof args.mine === "boolean") setMine(args.mine);
        return "Filter changed.";
      }
    }),
    [base]
  );

  const agent = useAgent({
    url: `/api/projects/${projectId}/agent`,
    tools: UI_TOOLS,
    getState: getAgentState,
    getContext: getAgentContext,
    handlers: toolHandlers,
    onDataChanged: load
  });

  const handOff = (id: string, text: string) => {
    pendingHandoff = { projectId: id, text, at: Date.now() };
    navigate(`/p/${id}`);
  };
  const scopeHandlers = {
    onOpenElsewhere: handOff,
    onStartProject: async (name: string, text: string) => {
      try {
        const r = await api<{ id: string }>("/api/projects", { body: { name } });
        toast(`Created "${name}".`);
        handOff(r.id, text);
      } catch (e) {
        toast(errorText(e));
      }
    }
  };

  if (noAccess && !data) return <RequestAccess projectId={projectId} />;
  if (error && !data) {
    return (
      <>
        <SiteHeader title="Project" />
        <PageBody>
          <EmptyState title="This project cannot open" text={error}>
            <Button asChild>
              <Link to="/">Go to your projects</Link>
            </Button>
          </EmptyState>
        </PageBody>
      </>
    );
  }
  if (!data)
    return (
      <>
        <SiteHeader title="Loading…" />
        <PageBody>
          <p className="text-sm text-muted-foreground">Loading the project…</p>
        </PageBody>
      </>
    );

  const drawerTask = drawer && drawer.kind === "edit" ? (data.tasks.find((t) => t.id === drawer.id) ?? null) : null;
  const tabs: Array<[View, string, string, string]> = [
    ["board", base, "board", "Board"],
    ["timeline", `${base}/timeline`, "timeline", "Timeline"],
    ["calendar", `${base}/calendar`, "calendar", "Calendar"],
    ["members", `${base}/members`, "users", "People"]
  ];

  return (
    <>
      <SiteHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--pc-${data.project.color})` }} aria-hidden="true" />
            <span className="truncate">{data.project.name}</span>
          </span>
        }
      >
        <ViewingNow viewers={liveConn.viewers} meId={me.id} live={liveConn.connected} />
        {data.agentLevel !== "off" && (
          <Button variant="outline" size="sm" onClick={() => setAiOpen(true)} data-open-agent="">
            <Icon name="sparkle" /> <span className="hidden sm:inline">AI agent</span>
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Project settings" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Project settings</TooltipContent>
        </Tooltip>
        {canEdit && view !== "members" && (
          <Button size="sm" onClick={() => setDrawer({ kind: "new" })}>
            <Icon name="plus" /> <span className="hidden sm:inline">New task</span>
          </Button>
        )}
      </SiteHeader>

      <PageBody>
        {(data.project.description || data.tasks.length > 0) && (
          <div className="grid gap-2">
            {data.project.description && (
              <p className="max-w-3xl text-sm text-muted-foreground" data-project-desc="">
                <LinkedText text={data.project.description} />
              </p>
            )}
            <Summary tasks={data.tasks} />
          </div>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <nav
            className="inline-flex h-9 w-fit max-w-full items-center overflow-x-auto rounded-lg bg-muted p-[3px] text-muted-foreground"
            aria-label="Project views"
          >
            {tabs.map(([id, to, icon, label]) => (
              <Link
                key={id}
                to={to}
                aria-current={view === id ? "page" : undefined}
                className="inline-flex h-[calc(100%-1px)] shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm dark:aria-[current=page]:bg-input/30"
              >
                <Icon name={icon} />
                {label}
                {id === "members" && (
                  <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1 tabular">
                    {data.members.length}
                  </Badge>
                )}
              </Link>
            ))}
          </nav>
          {view !== "members" && (
            <div className="flex items-center gap-3 md:ml-auto">
              <Input
                type="search"
                className="h-8 w-full md:w-64"
                placeholder="Filter tasks and notes"
                aria-label="Filter tasks by title, phase or notes"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                data-filter=""
              />
              <div className="flex shrink-0 items-center gap-2">
                <Switch id="only-mine" checked={mine} onCheckedChange={setMine} />
                <Label htmlFor="only-mine" className="font-normal whitespace-nowrap">
                  My tasks
                </Label>
              </div>
            </div>
          )}
        </div>

        {offline && <Notice>The server cannot be reached. Changes from others may be out of date.</Notice>}
        {!canEdit && <Notice tone="info">Your role is Viewer. You can see this project. Ask an owner for Editor access to make changes.</Notice>}

        {view === "board" && (
          <Board
            columns={data.columns}
            isOwner={!!isOwner}
            columnActions={columnActions}
            tasks={visible}
            hasAny={data.tasks.length > 0}
            members={membersById}
            attachments={data.attachments}
            canEdit={canEdit}
            onOpen={(id) => setDrawer({ kind: "edit", id })}
            onAdd={(columnId) => setDrawer({ kind: "new", columnId })}
            onMove={(id, columnId, order) => quickPatch(id, { columnId, order })}
            onDragState={setBusy}
          />
        )}
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          {view === "timeline" && (
            <Timeline
              tasks={visible}
              hasAny={data.tasks.length > 0}
              members={membersById}
              canEdit={canEdit}
              onOpen={(id) => setDrawer({ kind: "edit", id })}
              onReschedule={(id, start, end) => quickPatch(id, { start, end }, `Moved to ${fmtShort(start)}.`)}
              onDragState={setBusy}
              onAdd={() => setDrawer({ kind: "new" })}
            />
          )}
          {view === "calendar" && (
            <Calendar
              columns={data.columns}
              tasks={visible}
              hasAny={data.tasks.length > 0}
              members={membersById}
              canEdit={canEdit}
              focusDate={focusDate}
              onOpen={(id) => setDrawer({ kind: "edit", id })}
              onAdd={(date) => setDrawer({ kind: "new", start: date, end: date })}
              onReschedule={(id, start, end) => quickPatch(id, { start, end }, `Dates changed to ${fmtRange(start, end)}.`)}
              onDragState={setBusy}
            />
          )}
          {view === "members" && <Members data={data} me={me} isOwner={!!isOwner} onChanged={load} />}
        </Suspense>
      </PageBody>

      <Suspense fallback={null}>
        {drawer && (
          <TaskDrawer
            target={drawer}
            task={drawerTask}
            tasks={data.tasks}
            columns={data.columns}
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
        {aiOpen && (
          <AiDialog
            projectId={projectId}
            canEdit={canEdit}
            provider={config.aiProvider}
            agent={agent}
            level={data.agentLevel}
            initialQuestion={aiDraft}
            scope={scopeHandlers}
            onClose={() => {
              setAiOpen(false);
              setAiDraft("");
            }}
            onAdded={load}
          />
        )}
        {settingsOpen && <ProjectSettings data={data} me={me} canEdit={canEdit} isOwner={!!isOwner} onClose={() => setSettingsOpen(false)} onSaved={load} />}
      </Suspense>
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground" data-summary="">
      <span
        className="flex h-2 w-28 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={STATUSES.map((s) => `${s.label} ${counts[s.id]}`).join(", ")}
      >
        {STATUSES.map((s) =>
          counts[s.id] ? <span key={s.id} style={{ flex: counts[s.id], background: `var(--s-${s.id})` }} title={`${s.label}: ${counts[s.id]}`} /> : null
        )}
      </span>
      <span className="tabular">
        <b className="font-medium text-foreground">{tasks.length}</b> {tasks.length === 1 ? "task" : "tasks"}
      </span>
      <span className="tabular">
        <b className="font-medium text-foreground">{pct}%</b> done
      </span>
      <span className="tabular">
        <b className="font-medium text-foreground">{counts.doing}</b> in progress
      </span>
      {late > 0 && (
        <span className="tabular text-priority-high">
          <b className="font-medium">{late}</b> late
        </span>
      )}
      {next && (
        <span className="min-w-0 truncate">
          Next due: <b className="font-medium text-foreground tabular">{fmtShort(next.end!)}</b> {next.title}
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
  const [visibility, setVisibility] = useState<Visibility>(data.project.visibility);
  const [busy, setBusy] = useState(false);
  const onProject = data.members.some((m) => m.userId === me.id);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name, description, color };
      if (isOwner && visibility !== data.project.visibility) body.visibility = visibility;
      await api(`/api/projects/${data.project.id}`, { method: "PATCH", body });
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
    <Modal title="Project settings" onClose={onClose} wide>
      <form className="grid gap-5" onSubmit={save}>
        <fieldset className="grid gap-5 disabled:opacity-70" disabled={!canEdit}>
          <Field label="Name" htmlFor="ps-name">
            <Input id="ps-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="ps-desc" help="Web addresses that start with https:// or www. show as links. They open in a new tab.">
            <Textarea id="ps-desc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Color</legend>
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((c) => (
                <label
                  key={c}
                  title={c}
                  className="relative size-7 cursor-pointer rounded-full ring-offset-2 ring-offset-background has-[:checked]:ring-2 has-[:checked]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  style={{ background: `var(--pc-${c})` }}
                >
                  <input type="radio" name="ps-color" value={c} checked={color === c} onChange={() => setColor(c)} className="sr-only" />
                  <span className="sr-only">{c}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        <fieldset className="grid gap-2 disabled:opacity-70" disabled={!isOwner}>
          <ChoiceGroup
            legend="Who can see it"
            name="ps-visibility"
            value={visibility}
            onChange={(v) => setVisibility(v as Visibility)}
            options={VISIBILITIES.map((v) => [v, VISIBILITY_LABELS[v], VISIBILITY_HELP[v]])}
          />
          {!isOwner && <p className="text-xs text-muted-foreground">Only project owners can change who can see the project.</p>}
        </fieldset>
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !name.trim()}>
              Save
            </Button>
          </div>
        )}
      </form>
      {(onProject || isOwner) && (
        <>
          <Separator />
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              {onProject && <ConfirmButton label="Leave project" confirmLabel="Click again to leave" onConfirm={leave} />}
              {isOwner && (
                <ConfirmButton
                  label={
                    <>
                      <Icon name="trash" /> Delete project
                    </>
                  }
                  confirmLabel="Click again to delete everything"
                  onConfirm={remove}
                />
              )}
            </div>
            {isOwner && <p className="text-xs text-muted-foreground">Deleting a project removes its tasks and files for everyone. You cannot undo it.</p>}
          </div>
        </>
      )}
      <Separator />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AiSettings projectId={data.project.id} policy={data.aiPolicy} isOwner={isOwner} members={data.members} onSaved={onSaved} />
      </Suspense>
    </Modal>
  );
}

/** Shown when someone opens a link to a project they cannot see. It never shows the project's name. */
function RequestAccess({ projectId }: { projectId: string }) {
  const toast = useToast();
  const [state, setState] = useState<"loading" | "ready" | "sent">("loading");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ hasAccess: boolean; requested: boolean }>(`/api/projects/${projectId}/access`)
      .then((r) => (r.hasAccess ? location.reload() : setState(r.requested ? "sent" : "ready")))
      .catch(() => setState("ready"));
  }, [projectId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/access-requests`, { body: { note } });
      setState("sent");
    } catch (err) {
      toast(errorText(err));
      setBusy(false);
    }
  };

  return (
    <>
      <SiteHeader title="Request access" />
      <PageBody>
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center" data-access-state="">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
            <Icon name="shield" size={22} />
          </span>
          {state === "sent" ? (
            <>
              <h2 className="text-lg font-semibold">Your request was sent</h2>
              <p className="text-sm text-muted-foreground">
                The project owners got an email. You get an email when they approve it. Then this link opens the project.
              </p>
              <Button asChild variant="outline" className="mt-2">
                <Link to="/">Go to your projects</Link>
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">You need access to this project</h2>
              <p className="text-sm text-muted-foreground">
                This project is private, or it belongs to a company that you are not in. Ask the owners for access.
              </p>
              <form className="mt-2 grid w-full gap-4 text-left" onSubmit={send}>
                <Field label="Note to the owners (optional)" htmlFor="ra-note">
                  <Textarea
                    id="ra-note"
                    rows={3}
                    maxLength={300}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="For example: I am the new designer on this launch."
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link to="/">Cancel</Link>
                  </Button>
                  <Button type="submit" disabled={busy || state === "loading"}>
                    Request access
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}

/** Who else has this project open right now. Live updates only. */
function ViewingNow({ viewers, meId, live }: { viewers: Viewer[]; meId: string; live: boolean }) {
  const others = viewers.filter((v) => v.userId !== meId);
  if (!live) return null;
  return (
    <div className="hidden items-center gap-2 sm:flex" aria-live="polite" data-viewing="">
      <span className="relative flex size-2" title="Live: changes from others appear at once" aria-hidden="true" data-live-dot="">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50" />
        <span className="relative inline-flex size-2 rounded-full bg-live" />
      </span>
      {others.length ? (
        <>
          <span className="flex -space-x-1.5" data-viewers="">
            {others.slice(0, 4).map((v) => (
              <span key={v.userId} title={`${v.name} is viewing`} className="rounded-full ring-2 ring-background">
                <Avatar id={v.userId} name={v.name} size={24} />
              </span>
            ))}
          </span>
          <span className="sr-only">{others.map((v) => v.name).join(", ")} also viewing</span>
          {others.length > 4 && <span className="text-xs text-muted-foreground">+{others.length - 4}</span>}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">Live</span>
      )}
    </div>
  );
}
