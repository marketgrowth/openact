import { useState } from "react";
import { PRIORITIES, type PlannedTask } from "../../shared/types";
import { api, errorText } from "@openact/ui";
import { fmtRange, today } from "@openact/ui";
import { Notice, useToast, Field } from "@openact/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@openact/ui/components/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@openact/ui/components/tabs";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Textarea } from "@openact/ui/components/textarea";
import { AskPanel, type ScopeHandlers } from "./AskPanel";
import type { RunView } from "../agui/reducer";
import type { Decision } from "../agui/useAgent";
import type { AgentLevel } from "../../shared/types";

export interface AgentControls {
  view: RunView;
  ask: (q: string) => void;
  decide: (d: Decision[]) => void;
  keepHere: (messageId: string) => void;
  stop: () => void;
  reset: () => void;
}

/** AI assist: ask about the project (AG-UI), draft tasks from a goal, or write a status summary. Requests go through Cloudflare AI Gateway. */
export function AiDialog({
  projectId,
  canEdit,
  provider,
  agent,
  level,
  initialQuestion,
  scope,
  onClose,
  onAdded
}: {
  projectId: string;
  canEdit: boolean;
  provider: string;
  agent: AgentControls;
  level: AgentLevel;
  initialQuestion?: string;
  scope: Omit<ScopeHandlers, "onKeepHere">;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"ask" | "plan" | "summary">("ask");
  const [goal, setGoal] = useState("");
  const [start, setStart] = useState(today());
  const [drafts, setDrafts] = useState<PlannedTask[] | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ tasks: PlannedTask[] }>(`/api/projects/${projectId}/ai/plan`, { body: { goal, start } });
      setDrafts(r.tasks);
      setPicked(r.tasks.map(() => true));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const chosen = (drafts ?? []).filter((_, i) => picked[i]);
    if (!chosen.length) return;
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/tasks/bulk`, { body: { tasks: chosen.map((t) => ({ ...t, status: "backlog" })) } });
      toast(`Added ${chosen.length} ${chosen.length === 1 ? "task" : "tasks"} to the backlog.`);
      onAdded();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const summarize = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ summary: string }>(`/api/projects/${projectId}/ai/summary`, { method: "POST", body: {} });
      setSummary(r.summary);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary ?? "");
      toast("Copied.");
    } catch {
      toast("Copy did not work. Select the text and copy it.");
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg" data-ai-panel="">
        <SheetHeader className="border-b">
          <SheetTitle>AI agent</SheetTitle>
          <SheetDescription>AI can make mistakes. Check the output. Provider: {provider}, through Cloudflare AI Gateway.</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="px-4 pt-3">
            <TabsList aria-label="AI tools" className="w-full">
              <TabsTrigger value="ask">Agent</TabsTrigger>
              {canEdit && <TabsTrigger value="plan">Draft tasks</TabsTrigger>}
              <TabsTrigger value="summary">Status summary</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="ask" className="flex min-h-0 flex-1 flex-col">
            <AskPanel
              view={agent.view}
              level={level}
              initialQuestion={initialQuestion}
              scope={{ ...scope, onKeepHere: agent.keepHere }}
              onAsk={agent.ask}
              onDecide={agent.decide}
              onStop={agent.stop}
              onReset={agent.reset}
            />
          </TabsContent>

          <TabsContent value="plan" className="min-h-0 flex-1 overflow-y-auto p-4">
            {!drafts ? (
              <form className="grid gap-4" onSubmit={plan}>
                <p className="text-sm text-muted-foreground">
                  Describe the goal. AI drafts tasks with phases and dates. You check them before anything is added.
                </p>
                <Field label="Goal" htmlFor="ai-goal">
                  <Textarea
                    id="ai-goal"
                    rows={4}
                    maxLength={2000}
                    required
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="For example: Launch a fall fundraising campaign with an email series, a donation page and two events."
                  />
                </Field>
                <Field label="Start date" htmlFor="ai-start" className="max-w-48">
                  <Input id="ai-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </Field>
                {error && <Notice tone="error">{error}</Notice>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={busy || !goal.trim()}>
                    {busy ? "Drafting…" : "Draft tasks"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="grid gap-4">
                <p className="text-sm text-muted-foreground">Clear the tasks you do not want. The rest go to the backlog.</p>
                <ul className="divide-y rounded-lg border">
                  {drafts.map((t, i) => (
                    <li key={i}>
                      <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-accent/50">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-primary"
                          checked={picked[i]}
                          onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.checked : v)))}
                        />
                        <span className="grid gap-0.5">
                          <span className="text-sm font-medium">{t.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {t.phase || "No phase"} · {fmtRange(t.start, t.end)} · {PRIORITIES[t.priority]}
                          </span>
                          {t.notes && <span className="text-xs text-muted-foreground">{t.notes}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {error && <Notice tone="error">{error}</Notice>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDrafts(null)}>
                    Change the goal
                  </Button>
                  <Button type="button" disabled={busy || !picked.some(Boolean)} onClick={add}>
                    Add {picked.filter(Boolean).length} tasks
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="summary" className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                AI reads the task titles, statuses, dates and assignees. It does not read notes, files or email addresses.
              </p>
              {summary && <div className="rounded-lg border bg-muted/40 p-4 text-sm whitespace-pre-wrap">{summary}</div>}
              {error && <Notice tone="error">{error}</Notice>}
              <div className="flex justify-end gap-2">
                {summary && (
                  <Button type="button" variant="outline" onClick={copy}>
                    Copy
                  </Button>
                )}
                <Button type="button" disabled={busy} onClick={summarize}>
                  {busy ? "Writing…" : summary ? "Write again" : "Write a summary"}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
