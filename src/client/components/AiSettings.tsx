import { useEffect, useState } from "react";
import {
  AGENT_LEVELS,
  AGENT_LEVEL_HELP,
  AGENT_LEVEL_LABELS,
  AGENT_SCOPES,
  AGENT_SCOPE_HELP,
  AGENT_SCOPE_LABELS,
  ROLE_LABELS,
  type AgentAction,
  type AgentLevel,
  type AgentScope,
  type AiPolicy,
  type Member,
  type Role
} from "../../shared/types";
import { ROLE_CEILING, levelRank } from "../../shared/agent-policy";
import { api, errorText } from "../api";
import { fmtDateTime } from "../dates";
import { useToast } from "../ui";

const ROLE_ORDER: Role[] = ["owner", "editor", "viewer"];
const STATUS_TEXT: Record<AgentAction["status"], string> = {
  done: "Done",
  approved: "Approved",
  pending: "Waiting",
  rejected: "Rejected",
  denied: "Not allowed",
  failed: "Failed",
  expired: "Expired"
};

/** Results of the scope check use their own labels. */
function statusText(a: AgentAction): string {
  if (a.tool === "scope_check") return a.status === "denied" ? "Out of scope" : "Routed";
  return STATUS_TEXT[a.status];
}

/** The project's AI agent policy (owners edit it) and the log of what the agent did. */
export function AiSettings({ projectId, policy, isOwner, members, onSaved }: { projectId: string; policy: AiPolicy; isOwner: boolean; members: Member[]; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<AiPolicy>(policy);
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<AgentAction[] | null>(null);
  const names = Object.fromEntries(members.map((m) => [m.userId, m.name || m.email]));
  const dirty = ROLE_ORDER.some((r) => draft[r] !== policy[r]) || draft.scope !== policy.scope;

  useEffect(() => setDraft(policy), [policy]);
  useEffect(() => {
    api<{ actions: AgentAction[] }>(`/api/projects/${projectId}/agent-actions`)
      .then((r) => setActions(r.actions))
      .catch(() => setActions([]));
  }, [projectId]);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/ai-policy`, { method: "PATCH", body: draft });
      toast("AI access saved.");
      onSaved();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div>
        <h3 className="sub-h">AI agent access</h3>
        <p className="hint">The agent acts for the person who uses it. It can never do more than that person's role allows. {isOwner ? "You can give each role less." : "Owners set this."}</p>
      </div>
      <div className="policy">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="policy-row">
            <span className="policy-role">{ROLE_LABELS[role]}s</span>
            <select
              aria-label={`Agent access for ${ROLE_LABELS[role]}s`}
              value={draft[role]}
              disabled={!isOwner}
              onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value as AgentLevel }))}
            >
              {AGENT_LEVELS.filter((l) => levelRank(l) <= levelRank(ROLE_CEILING[role])).map((l) => (
                <option key={l} value={l}>
                  {AGENT_LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
            <span className="hint">{AGENT_LEVEL_HELP[draft[role]]}</span>
          </div>
        ))}
      </div>
      <p className="hint">Deletes, changes to people, and 5 or more changes at once always wait for the person to approve them.</p>
      <div>
        <h3 className="sub-h">Topic scope</h3>
        <p className="hint">
          A quick check reads each new request first. Requests for another project or for new work get a link to the right place. Other requests get a short
          decline and do not use the main AI model.
        </p>
      </div>
      <div className="policy">
        <div className="policy-row">
          <span className="policy-role">Scope</span>
          <select aria-label="Topic scope" value={draft.scope} disabled={!isOwner} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as AgentScope }))}>
            {AGENT_SCOPES.map((sc) => (
              <option key={sc} value={sc}>
                {AGENT_SCOPE_LABELS[sc]}
              </option>
            ))}
          </select>
          <span className="hint">{AGENT_SCOPE_HELP[draft.scope]}</span>
        </div>
      </div>
      {isOwner && (
        <div className="row-end">
          <button type="button" className="btn primary" disabled={!dirty || busy} onClick={save}>
            Save AI access
          </button>
        </div>
      )}

      <div>
        <h3 className="sub-h">Agent activity</h3>
        <p className="hint">Every change the agent makes or proposes, and every request it declines or sends elsewhere. Declined requests show a short topic, not the message.</p>
      </div>
      {actions === null && <p className="hint">Loading…</p>}
      {actions && actions.length === 0 && <p className="hint">The agent has not made any changes yet.</p>}
      {actions && actions.length > 0 && (
        <ul className="activity">
          {actions.map((a) => (
            <li key={a.id}>
              <span className={`chip st-${a.status}`}>{statusText(a)}</span>
              <span className="act-main">
                <span>{a.summary}</span>
                <span className="hint">
                  For {a.userId ? names[a.userId] ?? "a former member" : "a deleted account"}, {fmtDateTime(a.createdAt)}
                  {a.result && a.status !== "done" && a.status !== "approved" ? `. ${a.result}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
