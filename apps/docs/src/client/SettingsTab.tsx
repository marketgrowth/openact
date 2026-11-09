import { useState } from "react";
import { api, errorText, useToast } from "@openact/ui";
import { Label } from "@openact/ui/components/label";
import { Switch } from "@openact/ui/components/switch";

/** Company settings, Docs tab: turns AI writing help on or off for the whole company. */
export function DocsSettingsTab({ detail, onChanged }: { detail: { id: string; docsAi?: unknown }; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [on, setOn] = useState(detail.docsAi === true);
  const [busy, setBusy] = useState(false);

  const save = async (next: boolean) => {
    setBusy(true);
    try {
      await api(`/api/companies/${detail.id}`, { method: "PATCH", body: { docsAi: next } });
      setOn(next);
      toast(next ? "AI writing help is on in Docs." : "AI writing help is off in Docs.");
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4" data-docs-settings="">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="grid gap-1">
          <Label htmlFor="docs-ai">AI writing help</Label>
          <p className="text-sm text-muted-foreground">
            People can select text in a doc and ask the AI to improve, shorten, translate or continue it. The selected text, and up to 1,500 characters before
            and after it, go to this company's AI provider. Nothing else from the doc goes to the AI.
          </p>
          <p className="text-xs text-muted-foreground">Choose who can use it in the Permissions tab, under Use AI writing help.</p>
        </div>
        <Switch id="docs-ai" checked={on} disabled={busy} onCheckedChange={save} data-docs-ai-switch="" />
      </div>
    </div>
  );
}
