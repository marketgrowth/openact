import { useState } from "react";
import { PRIORITIES, type PlannedTask } from "../../shared/types";
import { api, errorText } from "../api";
import { fmtRange, today } from "../dates";
import { Modal, useToast } from "../ui";
import { AskPanel } from "./AskPanel";
import type { RunView } from "../agui/reducer";
import type { Decision } from "../agui/useAgent";
import type { AgentLevel } from "../../shared/types";

export interface AgentControls {
  view: RunView;
  ask: (q: string) => void;
  decide: (d: Decision[]) => void;
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
  onClose,
  onAdded
}: {
  projectId: string;
  canEdit: boolean;
  provider: string;
  agent: AgentControls;
  level: AgentLevel;
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
    <Modal title="AI agent" onClose={onClose} wide>
      <div className="seg" role="tablist" aria-label="AI tools">
        <button type="button" role="tab" aria-selected={tab === "ask"} aria-pressed={tab === "ask"} onClick={() => setTab("ask")}>
          Agent
        </button>
        {canEdit && (
          <button type="button" role="tab" aria-selected={tab === "plan"} aria-pressed={tab === "plan"} onClick={() => setTab("plan")}>
            Draft tasks
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "summary"} aria-pressed={tab === "summary"} onClick={() => setTab("summary")}>
          Status summary
        </button>
      </div>

      {tab === "ask" && <AskPanel view={agent.view} level={level} onAsk={agent.ask} onDecide={agent.decide} onStop={agent.stop} onReset={agent.reset} />}

      {tab === "plan" && !drafts && (
        <form className="stack" onSubmit={plan}>
          <p className="muted">Describe the goal. AI drafts tasks with phases and dates. You check them before anything is added.</p>
          <div className="field">
            <label htmlFor="ai-goal">Goal</label>
            <textarea id="ai-goal" rows={4} maxLength={2000} required value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="For example: Launch a fall fundraising campaign with an email series, a donation page and two events." />
          </div>
          <div className="field narrow">
            <label htmlFor="ai-start">Start date</label>
            <input id="ai-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row-end">
            <button type="submit" className="btn primary" disabled={busy || !goal.trim()}>
              {busy ? "Drafting…" : "Draft tasks"}
            </button>
          </div>
        </form>
      )}

      {tab === "plan" && drafts && (
        <div className="stack">
          <p className="muted">Clear the tasks you do not want. The rest go to the backlog.</p>
          <ul className="draft-list">
            {drafts.map((t, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={picked[i]} onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.checked : v)))} />
                  <span>
                    <b>{t.title}</b>
                    <span className="hint">
                      {t.phase || "No phase"} · {fmtRange(t.start, t.end)} · {PRIORITIES[t.priority]}
                    </span>
                    {t.notes && <span className="hint">{t.notes}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row-end">
            <button type="button" className="btn ghost" onClick={() => setDrafts(null)}>
              Change the goal
            </button>
            <button type="button" className="btn primary" disabled={busy || !picked.some(Boolean)} onClick={add}>
              Add {picked.filter(Boolean).length} tasks
            </button>
          </div>
        </div>
      )}

      {tab === "summary" && (
        <div className="stack">
          <p className="muted">AI reads the task titles, statuses, dates and assignees. It does not read notes, files or email addresses.</p>
          {summary && <div className="ai-summary">{summary}</div>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row-end">
            {summary && (
              <button type="button" className="btn ghost" onClick={copy}>
                Copy
              </button>
            )}
            <button type="button" className="btn primary" disabled={busy} onClick={summarize}>
              {busy ? "Writing…" : summary ? "Write again" : "Write a summary"}
            </button>
          </div>
        </div>
      )}
      <p className="hint ai-foot">AI can make mistakes. Check the output. Provider: {provider}, through Cloudflare AI Gateway.</p>
    </Modal>
  );
}
