import { useState } from "react";
import {
  AGENT_LEVELS,
  AGENT_LEVEL_LABELS,
  AGENT_SCOPES,
  AGENT_SCOPE_LABELS,
  ROLE_LABELS,
  type AgentLevel,
  type AgentScope,
  type AiPolicy,
  type CompanyDetail,
  type Role
} from "../../shared/types";
import { ROLE_CEILING, levelRank } from "../../shared/agent-policy";
import { api, errorText, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Label } from "@openact/ui/components/label";
import { Switch } from "@openact/ui/components/switch";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";

/* A tab in Company settings: the AI settings that new projects in the company start with. */

const ROLE_ORDER: Role[] = ["owner", "editor", "viewer"];

export function AiDefaultsTab({ detail, onChanged }: { detail: CompanyDetail; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [draft, setDraft] = useState<AiPolicy>(detail.aiDefaults);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/companies/${detail.id}`, { method: "PATCH", body: { aiDefaults: draft } });
      toast("AI defaults saved. New projects start with them.");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        New projects in this company start with these settings. Project owners can change them later. Existing projects keep their own settings.
      </p>
      <div className="divide-y rounded-lg border" data-policy="">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm font-medium">{ROLE_LABELS[role]}s</span>
            <NativeSelect
              size="sm"
              aria-label={`Default agent level for ${ROLE_LABELS[role].toLowerCase()}s`}
              value={draft[role]}
              onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value as AgentLevel }))}
            >
              {AGENT_LEVELS.filter((l) => levelRank(l) <= levelRank(ROLE_CEILING[role])).map((l) => (
                <NativeSelectOption key={l} value={l}>
                  {AGENT_LEVEL_LABELS[l]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-sm font-medium">Topic scope</span>
          <NativeSelect
            size="sm"
            aria-label="Default topic scope"
            value={draft.scope}
            onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as AgentScope }))}
          >
            {AGENT_SCOPES.map((sc) => (
              <NativeSelectOption key={sc} value={sc}>
                {AGENT_SCOPE_LABELS[sc]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="cs-notes" checked={draft.readNotes} onCheckedChange={(v) => setDraft((d) => ({ ...d, readNotes: v }))} />
        <Label htmlFor="cs-notes">Let the agent search task notes</Label>
      </div>
      <div className="flex justify-end">
        <Button type="button" disabled={busy} onClick={save}>
          Save AI defaults
        </Button>
      </div>
    </div>
  );
}
