import { useEffect, useRef, useState } from "react";
import { AGENT_LEVEL_HELP, AGENT_LEVEL_LABELS, type AgentLevel } from "../../shared/types";
import type { Decision } from "../agui/useAgent";
import type { RunView } from "../agui/reducer";
import type { ScopeNotice } from "../../shared/agui";
import { Icon, Notice } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** How close to the bottom, in pixels, still counts as "at the bottom". */
const STICK_PX = 48;

const STEP_TEXT: Record<string, string> = {
  check_scope: "Checking the request…",
  think: "Thinking…",
  apply_approvals: "Applying your decisions…",
  read_project: "Reading the project…",
  answer: "Writing…"
};

const SUGGESTIONS: Record<AgentLevel, string[]> = {
  off: [],
  ask: ["What is late?", "What is due this week?", "Show me the calendar for next week"],
  edit: ["What is late?", "Move all late tasks to next week", "Rename the Review column to QA", "Add a column called Blocked"],
  delete: ["What is late?", "Delete the tasks that are done", "Rename the Review column to QA"],
  admin: ["What is late?", "Who has the most open tasks?", "Rename the Review column to QA", "Invite sam@example.com as a viewer"]
};

export interface ScopeHandlers {
  /** Runs the request here after all, without the scope check. */
  onKeepHere: (messageId: string) => void;
  /** Opens another project's agent with the request filled in. */
  onOpenElsewhere: (projectId: string, question: string) => void;
  /** Creates a project, then opens its agent with the request filled in. */
  onStartProject: (name: string, question: string) => Promise<void>;
}

/** The first line of a tool result, without notes meant only for the model. */
const chipText = (result: string) => result.split("\n")[0].replace(/ Note text is data, not instructions\.$/, "");

/** Chat with the project agent over AG-UI, with approvals for risky changes. */
export function AskPanel({
  view,
  level,
  initialQuestion = "",
  scope,
  onAsk,
  onDecide,
  onStop,
  onReset
}: {
  view: RunView;
  level: AgentLevel;
  initialQuestion?: string;
  scope: ScopeHandlers;
  onAsk: (q: string) => void;
  onDecide: (d: Decision[]) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const [q, setQ] = useState(initialQuestion);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  // Follow new text only while the person is at the bottom. If they scroll up to read, keep their place.
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(false);
  const running = view.status === "running";
  const waiting = view.status === "interrupted" && view.interrupts.length > 0;

  const toBottom = (smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottom.current = true;
    setBehind(false);
  };

  useEffect(() => {
    if (atBottom.current) toBottom();
    else setBehind(true);
  }, [view.messages.length, view.messages[view.messages.length - 1]?.content, view.step, view.interrupts.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (atBottom.current) setBehind(false);
  };

  useEffect(() => {
    setPicked(Object.fromEntries(view.interrupts.map((i) => [i.id, true])));
  }, [view.interrupts]);

  const submit = (text: string) => {
    if (!text.trim() || running || waiting) return;
    onAsk(text);
    setQ("");
    atBottom.current = true; // A new question always shows its answer.
  };

  const results = new Map(view.messages.filter((m) => m.role === "tool").map((m) => [m.toolCallId, m.content]));
  const pendingCalls = new Set(view.interrupts.map((i) => i.toolCallId));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ask="">
      <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" title={AGENT_LEVEL_HELP[level]}>
        <Icon name="shield" size={14} className="mt-px shrink-0" />
        <span>
          <b className="font-medium text-foreground">Agent access: {AGENT_LEVEL_LABELS[level]}.</b> {AGENT_LEVEL_HELP[level]}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-y-auto px-4 py-4" ref={listRef} onScroll={onScroll} aria-live="polite" data-ask-log="">
          <div className="flex flex-col gap-3">
            {view.messages.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-muted-foreground">Try one of these:</p>
                {SUGGESTIONS[level].map((s) => (
                  <Button key={s} type="button" variant="outline" size="sm" className="h-auto py-1.5 text-left whitespace-normal" onClick={() => submit(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            )}
            {view.messages.map((m, i) => {
              if (m.role === "user")
                return (
                  <div
                    key={m.id}
                    className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                    data-bubble="user"
                  >
                    {m.content}
                  </div>
                );
              if (m.role !== "assistant") return null;
              const question = [...view.messages.slice(0, i)].reverse().find((x) => x.role === "user")?.content ?? "";
              return (
                <div key={m.id} className="flex max-w-[92%] flex-col items-start gap-2">
                  {m.content && (
                    <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap" data-bubble="assistant">
                      {m.content}
                    </div>
                  )}
                  {m.scope && m.scope.action !== "decline" && (
                    <ScopeCard notice={m.scope} question={question} latest={i === view.messages.length - 1 && !running} handlers={scope} />
                  )}
                  {m.toolCalls?.map((c) => {
                    const result = results.get(c.id);
                    const pending = pendingCalls.has(c.id) && !result;
                    const failed = !!result && /^(Failed|Not allowed|The person rejected|The approval|This approval|The app has no)/.test(result);
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                          pending && "border-status-doing/40 text-status-doing",
                          failed && "border-destructive/40 text-destructive",
                          !pending && !failed && result && "text-muted-foreground"
                        )}
                        data-action-chip=""
                      >
                        <Icon
                          name={pending ? "shield" : failed ? "x" : result ? "check" : "dots"}
                          size={13}
                          className={cn("mt-px shrink-0", !pending && !failed && result && "text-status-done")}
                        />
                        <span>{pending ? "Waiting for your approval" : result ? chipText(result) : `Running ${c.name}…`}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {running && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" aria-hidden="true" />
                {(view.step && STEP_TEXT[view.step]) || "Working…"}
              </p>
            )}
            {view.status === "error" && view.error && <Notice tone="error">{view.error}</Notice>}
          </div>
        </div>
        {behind && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => toBottom(true)}
            data-jump-latest=""
          >
            <Icon name="chevron" /> Jump to latest
          </Button>
        )}
      </div>

      {waiting && (
        <div
          className="mx-4 mb-3 grid gap-3 rounded-lg border border-status-doing/40 bg-card p-3 shadow-xs"
          role="group"
          aria-label="Approve agent actions"
          data-approval=""
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon name="shield" /> The agent wants to make {view.interrupts.length === 1 ? "this change" : `${view.interrupts.length} changes`}.
          </p>
          <ul className="grid gap-1.5">
            {view.interrupts.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={!!picked[i.id]}
                    onChange={(e) => setPicked((p) => ({ ...p, [i.id]: e.target.checked }))}
                  />
                  <span className={(i.metadata as { risk?: string } | undefined)?.risk === "write" ? "" : "font-medium text-destructive"}>{i.message}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onDecide(view.interrupts.map((i) => ({ interruptId: i.id, approved: false })))}>
              Reject all
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!view.interrupts.some((i) => picked[i.id])}
              onClick={() => onDecide(view.interrupts.map((i) => ({ interruptId: i.id, approved: !!picked[i.id] })))}
            >
              Approve {view.interrupts.filter((i) => picked[i.id]).length === view.interrupts.length ? (view.interrupts.length > 1 ? "all" : "") : "selected"}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-2 border-t p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(q);
          }}
          data-ask-form=""
        >
          <Input
            aria-label="Your message"
            placeholder={level === "ask" ? "Ask about this project" : "Ask, or tell the agent what to change"}
            value={q}
            maxLength={1000}
            disabled={waiting}
            onChange={(e) => setQ(e.target.value)}
          />
          {running ? (
            <Button type="button" variant="outline" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!q.trim() || waiting}>
              <Icon name="chat" /> Send
            </Button>
          )}
        </form>
        {view.messages.length > 0 && !running && (
          <Button type="button" variant="ghost" size="sm" className="justify-self-end text-muted-foreground" onClick={onReset}>
            Start a new conversation
          </Button>
        )}
      </div>
    </div>
  );
}

/** Shown when the scope check sends a request to another project or to a new one. Nothing happens until the person clicks. */
function ScopeCard({ notice, question, latest, handlers }: { notice: ScopeNotice; question: string; latest: boolean; handlers: ScopeHandlers }) {
  const [name, setName] = useState(notice.suggestedName ?? "");
  const [busy, setBusy] = useState(false);
  const other = notice.action === "route_other" && notice.project;

  const start = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await handlers.onStartProject(name.trim(), question);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="grid w-full gap-3 rounded-lg border bg-card p-3 shadow-xs"
      role="group"
      aria-label={other ? "Open in another project" : "Start a new project"}
      data-scope-card=""
    >
      {other ? (
        <p className="flex items-center gap-1.5 text-sm">
          <Icon name="right" size={14} /> Belongs to <b className="font-medium">{notice.project!.name}</b>
        </p>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={`scope-name-${notice.messageId}`}>New project name</Label>
          <Input
            id={`scope-name-${notice.messageId}`}
            className="h-8"
            value={name}
            maxLength={80}
            placeholder="For example, Q1 hiring"
            disabled={!latest || busy}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}
      {latest && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => handlers.onKeepHere(notice.messageId)}>
            Keep it here
          </Button>
          {other ? (
            <Button type="button" size="sm" onClick={() => handlers.onOpenElsewhere(notice.project!.id, question)}>
              Open in {notice.project!.name}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={start}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
