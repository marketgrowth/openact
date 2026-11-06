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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const STATUS_TONE: Partial<Record<AgentAction["status"], string>> = {
  done: "border-status-done/40 text-status-done",
  approved: "border-status-done/40 text-status-done",
  pending: "border-status-doing/40 text-status-doing",
  rejected: "text-muted-foreground",
  denied: "border-destructive/40 text-destructive",
  failed: "border-destructive/40 text-destructive",
  expired: "text-muted-foreground"
};

function Section({ title, help, children }: { title: string; help: ReactNode; children?: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{help}</p>
      </div>
      {children}
    </section>
  );
}

function PolicyRow({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[7rem_auto_1fr] sm:items-center sm:gap-3">
      <span className="text-sm font-medium">{label}</span>
      {children}
      <span className="text-xs text-muted-foreground">{help}</span>
    </div>
  );
}

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
export function AiSettings({
  projectId,
  policy,
  isOwner,
  members,
  onSaved
}: {
  projectId: string;
  policy: AiPolicy;
  isOwner: boolean;
  members: Member[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<AiPolicy>(policy);
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<AgentAction[] | null>(null);
  const names = Object.fromEntries(members.map((m) => [m.userId, m.name || m.email]));
  const dirty = ROLE_ORDER.some((r) => draft[r] !== policy[r]) || draft.scope !== policy.scope || draft.readNotes !== policy.readNotes;

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
    <div className="grid gap-6" data-ai-settings="">
      <Section
        title="AI agent access"
        help={
          <>
            The agent acts for the person who uses it. It can never do more than that person's role allows.{" "}
            {isOwner ? "You can give each role less." : "Owners set this."}
          </>
        }
      >
        <div className="divide-y rounded-lg border" data-policy="">
          {ROLE_ORDER.map((role) => (
            <PolicyRow key={role} label={`${ROLE_LABELS[role]}s`} help={AGENT_LEVEL_HELP[draft[role]]}>
              <NativeSelect
                size="sm"
                aria-label={`Agent access for ${ROLE_LABELS[role]}s`}
                value={draft[role]}
                disabled={!isOwner}
                onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value as AgentLevel }))}
              >
                {AGENT_LEVELS.filter((l) => levelRank(l) <= levelRank(ROLE_CEILING[role])).map((l) => (
                  <NativeSelectOption key={l} value={l}>
                    {AGENT_LEVEL_LABELS[l]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </PolicyRow>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Deletes, changes to people, and 5 or more changes at once always wait for the person to approve them.</p>
      </Section>

      <Section
        title="Task notes"
        help="Notes can hold private details, so the agent cannot read them unless you turn this on. When it is on, the agent can search notes for words, such as a name. The AI provider gets only a short part of each matching note, with email addresses and phone numbers hidden."
      >
        <div className="flex items-center gap-3" data-policy-toggle="">
          <Switch id="ai-notes" checked={draft.readNotes} disabled={!isOwner} onCheckedChange={(v) => setDraft((d) => ({ ...d, readNotes: v }))} />
          <Label htmlFor="ai-notes">Let the agent search task notes</Label>
        </div>
      </Section>

      <Section
        title="Topic scope"
        help="A quick check reads each new request first. Requests for another project or for new work get a link to the right place. Other requests get a short decline and do not use the main AI model."
      >
        <div className="rounded-lg border">
          <PolicyRow label="Scope" help={AGENT_SCOPE_HELP[draft.scope]}>
            <NativeSelect
              size="sm"
              aria-label="Topic scope"
              value={draft.scope}
              disabled={!isOwner}
              onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as AgentScope }))}
            >
              {AGENT_SCOPES.map((sc) => (
                <NativeSelectOption key={sc} value={sc}>
                  {AGENT_SCOPE_LABELS[sc]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </PolicyRow>
        </div>
      </Section>
      {isOwner && (
        <div className="flex justify-end">
          <Button type="button" disabled={!dirty || busy} onClick={save}>
            Save AI access
          </Button>
        </div>
      )}

      <Section
        title="Agent activity"
        help="Every change the agent makes or proposes, and every request it declines or sends elsewhere. Declined requests show a short topic, not the message."
      >
        {actions === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {actions && actions.length === 0 && <p className="text-sm text-muted-foreground">The agent has not made any changes yet.</p>}
        {actions && actions.length > 0 && (
          <ul className="divide-y rounded-lg border" data-activity="">
            {actions.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                <Badge variant="outline" className={cn("mt-0.5 shrink-0", STATUS_TONE[a.status])}>
                  {statusText(a)}
                </Badge>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm">{a.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    For {a.userId ? (names[a.userId] ?? "a former member") : "a deleted account"}, {fmtDateTime(a.createdAt)}
                    {a.result && a.status !== "done" && a.status !== "approved" ? `. ${a.result}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
