import { useEffect, useState } from "react";
import { Field, Icon, Notice, api, errorText } from "@openact/ui";
import { Progress } from "@openact/ui/arc/progress";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { clockText, hoursOne, moneyText, entryCents, weekStatus, type EntryInfo, type MyProjectTime } from "../shared/projects";
import { companyApi, useCompanyData } from "./lib";
import { EntryDialog, ProjectSelect, StatusBadge, TaskSelect, localToday, projectLabel, useTasks } from "./project-parts";

/** My time for the Projects kind of work: the timer, today's time and this week, with Send week. */
export function ProjectTime() {
  const today = localToday();
  const data = useCompanyData<MyProjectTime>(`/my-projects?week=${today}`);
  const d = data.data;
  const companyId = data.companyId;
  const [editing, setEditing] = useState<EntryInfo | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!companyId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${companyApi(companyId)}/weeks/${today}/send`, {
        method: "POST",
        body: {}
      });
      data.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (data.error) return <Notice tone="error">{data.error}</Notice>;
  if (!d || !companyId) return <p className="text-sm text-muted-foreground">Loading your projects…</p>;

  const todays = d.entries.filter((e) => e.date === today && !e.timerStartedAt);
  const week = d.entries.reduce((n, e) => n + e.minutes, 0);
  const status = weekStatus(d.parts.filter((p) => p.minutes > 0));
  const canSend = !d.running && d.parts.some((p) => p.minutes > 0 && (p.status === "open" || p.status === "returned"));
  const returned = d.parts.filter((p) => p.status === "returned" && p.note);

  return (
    <div className="grid gap-4">
      {!d.projectsApp && <Notice tone="info">Turn on the Projects app for this company to log time on projects. A company owner or admin does this in Company settings.</Notice>}
      {d.projectsApp && !d.projects.length && <Notice tone="info">You have no projects to log time on. Ask a manager to add you to a project in the Projects app.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Timer companyId={companyId} d={d} today={today} onChanged={data.reload} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="grid gap-1.5">
              <CardTitle>Today</CardTitle>
              <CardDescription>{hoursOne(todays.reduce((n, e) => n + e.minutes, 0))}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={!d.projects.length}>
              <Icon name="plus" />
              Add time
            </Button>
          </CardHeader>
          <CardContent className="grid gap-1">
            {!todays.length && <p className="text-sm text-muted-foreground">No time today yet. Start the timer, or add time.</p>}
            {todays.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEditing(e)}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.clientName ? `${e.clientName} · ${e.projectName}` : e.projectName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[e.taskName, e.note].filter(Boolean).join(" · ") || "No note"}</span>
                </span>
                <span className="text-sm font-medium tabular-nums">{clockText(e.minutes)}</span>
                <span className="hidden w-24 text-right text-sm text-muted-foreground tabular-nums sm:block">
                  {e.billable && e.rateCents !== null ? moneyText(entryCents(e), d.currency) : "Not billed"}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="grid gap-1.5">
              <CardTitle>This week</CardTitle>
              <CardDescription>
                {hoursOne(week)}
                {d.weeklyMinutes ? ` of ${hoursOne(d.weeklyMinutes)} planned` : ""}
              </CardDescription>
            </div>
            {status !== "empty" && <StatusBadge status={status} />}
          </CardHeader>
          <CardContent className="grid gap-3">
            {d.weeklyMinutes ? <Progress value={Math.min(week, d.weeklyMinutes)} max={d.weeklyMinutes} aria-label="Hours this week" /> : null}
            {d.parts
              .filter((p) => p.minutes > 0)
              .map((p) => (
                <div key={p.clientId ?? "none"} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{p.clientName}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{hoursOne(p.minutes)}</span>
                    <StatusBadge status={p.status} />
                  </span>
                </div>
              ))}
            {returned.map((p) => (
              <Notice key={p.clientId ?? "none"} tone="warn">
                {p.clientName}: {p.note}
              </Notice>
            ))}
            <Button onClick={send} disabled={!canSend || busy}>
              Send week for approval
            </Button>
            {d.running && <p className="text-xs text-muted-foreground">Stop the timer before you send the week.</p>}
          </CardContent>
        </Card>
      </div>

      {editing && (
        <EntryDialog
          companyId={companyId}
          entry={editing === "new" ? null : editing}
          date={today}
          projects={d.projects}
          clients={d.clients}
          onClose={() => setEditing(null)}
          onSaved={data.reload}
        />
      )}
    </div>
  );
}

function elapsed(startIso: string, base: number): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 1000)) + base * 60;
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Timer({ companyId, d, today, onChanged }: { companyId: string; d: MyProjectTime; today: string; onChanged: () => void }) {
  const run = d.running;
  const [projectId, setProjectId] = useState(run?.projectId ?? "");
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const [billable, setBillable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const tasks = useTasks(companyId, run ? "" : projectId);
  const project = d.projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [run]);

  async function go(path: "start" | "stop") {
    setBusy(true);
    setError(null);
    try {
      await api(`${companyApi(companyId)}/timer/${path}`, {
        method: "POST",
        body: path === "start" ? { projectId, taskId: taskId || null, note, billable, date: today } : {}
      });
      if (path === "stop") setNote("");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        {run ? (
          <div className="grid gap-1">
            <span className="text-sm text-muted-foreground">Timer running</span>
            <span className="text-base font-medium">{projectLabel({ name: run.projectName, clientId: run.clientId }, d.clients)}</span>
            <span className="text-sm text-muted-foreground">{[run.taskName, run.note].filter(Boolean).join(" · ") || "No note"}</span>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Project" htmlFor="ws-timer-project">
              <ProjectSelect id="ws-timer-project" value={projectId} onChange={(v) => (setProjectId(v), setTaskId(""))} projects={d.projects} clients={d.clients} />
            </Field>
            <Field label="Task (optional)" htmlFor="ws-timer-task">
              <TaskSelect id="ws-timer-task" value={taskId} onChange={setTaskId} tasks={tasks} />
            </Field>
            <Field label="What are you working on?" htmlFor="ws-timer-note">
              <Input id="ws-timer-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-3xl font-semibold tabular-nums" aria-live="off">
            {run ? elapsed(run.timerStartedAt!, run.minutes) : "0:00:00"}
          </span>
          {run && (
            <span className="text-sm text-muted-foreground">
              Started{" "}
              {new Date(run.timerStartedAt!).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
              })}
            </span>
          )}
          <span className="flex-1" />
          {!run && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={billable && (project?.isBillable ?? true)} disabled={project ? !project.isBillable : false} onCheckedChange={(v) => setBillable(v === true)} />
              Billable
            </label>
          )}
          {run ? (
            <Button size="lg" variant="outline" onClick={() => go("stop")} disabled={busy}>
              Stop
            </Button>
          ) : (
            <Button size="lg" onClick={() => go("start")} disabled={busy || !projectId}>
              Start
            </Button>
          )}
        </div>
        {d.roundingMinutes > 0 && <p className="text-xs text-muted-foreground">Time rounds to the nearest {d.roundingMinutes} minutes.</p>}
      </CardContent>
    </Card>
  );
}
