import { useEffect, useRef, useState } from "react";
import { AGENT_LEVEL_HELP, AGENT_LEVEL_LABELS, type AgentLevel } from "../../shared/types";
import type { Decision } from "../agui/useAgent";
import type { RunView } from "../agui/reducer";
import { Icon } from "../ui";

const STEP_TEXT: Record<string, string> = { think: "Thinking…", apply_approvals: "Applying your decisions…", read_project: "Reading the project…", answer: "Writing…" };

const SUGGESTIONS: Record<AgentLevel, string[]> = {
  off: [],
  ask: ["What is late?", "What is due this week?", "Show me the calendar for next week"],
  edit: ["What is late?", "Move all late tasks to next week", "Rename the Review column to QA", "Add a column called Blocked"],
  delete: ["What is late?", "Delete the tasks that are done", "Rename the Review column to QA"],
  admin: ["What is late?", "Who has the most open tasks?", "Rename the Review column to QA", "Invite sam@example.com as a viewer"]
};

/** Chat with the project agent over AG-UI, with approvals for risky changes. */
export function AskPanel({
  view,
  level,
  onAsk,
  onDecide,
  onStop,
  onReset
}: {
  view: RunView;
  level: AgentLevel;
  onAsk: (q: string) => void;
  onDecide: (d: Decision[]) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const running = view.status === "running";
  const waiting = view.status === "interrupted" && view.interrupts.length > 0;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [view.messages.length, view.messages[view.messages.length - 1]?.content, view.step, view.interrupts.length]);

  useEffect(() => {
    setPicked(Object.fromEntries(view.interrupts.map((i) => [i.id, true])));
  }, [view.interrupts]);

  const submit = (text: string) => {
    if (!text.trim() || running || waiting) return;
    onAsk(text);
    setQ("");
  };

  const results = new Map(view.messages.filter((m) => m.role === "tool").map((m) => [m.toolCallId, m.content]));
  const pendingCalls = new Set(view.interrupts.map((i) => i.toolCallId));

  return (
    <div className="stack ask">
      <div className="agent-level" title={AGENT_LEVEL_HELP[level]}>
        <Icon name="shield" size={15} />
        <span>
          <b>Agent access: {AGENT_LEVEL_LABELS[level]}.</b> {AGENT_LEVEL_HELP[level]}
        </span>
      </div>
      <div className="ask-log" ref={listRef} aria-live="polite">
        {view.messages.length === 0 && (
          <div className="ask-suggest">
            {SUGGESTIONS[level].map((s) => (
              <button key={s} type="button" className="btn sm" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {view.messages.map((m) => {
          if (m.role === "user") return <div key={m.id} className="bubble user">{m.content}</div>;
          if (m.role !== "assistant") return null;
          return (
            <div key={m.id} className="turn">
              {m.content && <div className="bubble assistant">{m.content}</div>}
              {m.toolCalls?.map((c) => {
                const result = results.get(c.id);
                const pending = pendingCalls.has(c.id) && !result;
                const failed = !!result && /^(Failed|Not allowed|The person rejected|The approval|This approval|The app has no)/.test(result);
                return (
                  <div key={c.id} className={`action-chip${pending ? " pending" : failed ? " failed" : result ? " ok" : ""}`}>
                    <Icon name={pending ? "shield" : failed ? "x" : result ? "check" : "dots"} size={14} />
                    <span>{pending ? "Waiting for your approval" : result ?? `Running ${c.name}…`}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {running && <p className="hint ask-step">{(view.step && STEP_TEXT[view.step]) || "Working…"}</p>}
        {view.status === "error" && view.error && (
          <p className="error" role="alert">
            {view.error}
          </p>
        )}
      </div>

      {waiting && (
        <div className="approval" role="group" aria-label="Approve agent actions">
          <p className="approval-head">
            <Icon name="shield" size={16} /> <b>The agent wants to make {view.interrupts.length === 1 ? "this change" : `${view.interrupts.length} changes`}.</b>
          </p>
          <ul>
            {view.interrupts.map((i) => (
              <li key={i.id}>
                <label>
                  <input type="checkbox" checked={!!picked[i.id]} onChange={(e) => setPicked((p) => ({ ...p, [i.id]: e.target.checked }))} />
                  <span className={(i.metadata as { risk?: string } | undefined)?.risk === "write" ? "" : "risk"}>{i.message}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row-end">
            <button type="button" className="btn ghost" onClick={() => onDecide(view.interrupts.map((i) => ({ interruptId: i.id, approved: false })))}>
              Reject all
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!view.interrupts.some((i) => picked[i.id])}
              onClick={() => onDecide(view.interrupts.map((i) => ({ interruptId: i.id, approved: !!picked[i.id] })))}
            >
              Approve {view.interrupts.filter((i) => picked[i.id]).length === view.interrupts.length ? (view.interrupts.length > 1 ? "all" : "") : "selected"}
            </button>
          </div>
        </div>
      )}

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <input
          aria-label="Your message"
          placeholder={level === "ask" ? "Ask about this project" : "Ask, or tell the agent what to change"}
          value={q}
          maxLength={1000}
          disabled={waiting}
          onChange={(e) => setQ(e.target.value)}
        />
        {running ? (
          <button type="button" className="btn" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!q.trim() || waiting}>
            <Icon name="chat" size={16} /> Send
          </button>
        )}
      </form>
      {view.messages.length > 0 && !running && (
        <div className="row-end">
          <button type="button" className="btn ghost sm" onClick={onReset}>
            Start a new conversation
          </button>
        </div>
      )}
    </div>
  );
}
