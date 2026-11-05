import { useEffect, useRef, useState } from "react";
import type { RunView } from "../agui/reducer";
import { Icon } from "../ui";

const SUGGESTIONS = ["What is late?", "What is due this week?", "Who has the most open tasks?", "What should we do next?"];
const STEP_TEXT: Record<string, string> = { read_project: "Reading the project…", answer: "Writing the answer…" };

/** Chat with the project assistant over AG-UI. */
export function AskPanel({ view, onAsk, onStop, onReset }: { view: RunView; onAsk: (q: string) => void; onStop: () => void; onReset: () => void }) {
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const running = view.status === "running";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [view.messages.length, view.messages[view.messages.length - 1]?.content, view.step]);

  const submit = (text: string) => {
    if (!text.trim() || running) return;
    onAsk(text);
    setQ("");
  };

  const visible = view.messages.filter((m) => (m.role === "user" || m.role === "assistant") && (m.content || !m.toolCalls?.length));
  const actions = view.messages.filter((m) => m.role === "tool");

  return (
    <div className="stack ask">
      <p className="muted">Ask about tasks, dates and people in this project. The assistant reads titles, statuses, dates and assignees. It does not read notes, files or email addresses.</p>
      <div className="ask-log" ref={listRef} aria-live="polite">
        {visible.length === 0 && (
          <div className="ask-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="btn sm" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {visible.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {actions.length > 0 && <p className="hint">The assistant ran {actions.length} app {actions.length === 1 ? "action" : "actions"}.</p>}
        {running && <p className="hint ask-step">{(view.step && STEP_TEXT[view.step]) || "Working…"}</p>}
        {view.status === "error" && view.error && (
          <p className="error" role="alert">
            {view.error}
          </p>
        )}
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <input aria-label="Your question" placeholder="Ask about this project" value={q} maxLength={1000} onChange={(e) => setQ(e.target.value)} />
        {running ? (
          <button type="button" className="btn" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!q.trim()}>
            <Icon name="chat" size={16} /> Ask
          </button>
        )}
      </form>
      {visible.length > 0 && !running && (
        <div className="row-end">
          <button type="button" className="btn ghost sm" onClick={onReset}>
            Start a new conversation
          </button>
        </div>
      )}
    </div>
  );
}
