import { useState } from "react";
import { Notice, api, errorText, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { ADMIN_PATH, SITE_URL_MAX, cleanSiteUrl } from "../shared/rules";

/** Company settings, CMS tab: the address of the company's EmDash site. */
export function CmsSettingsTab({ detail, onChanged }: { detail: { id: string; cms?: unknown }; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const saved = ((detail.cms ?? {}) as { siteUrl?: string | null }).siteUrl ?? "";
  const [value, setValue] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (raw: string) => {
    const r = cleanSiteUrl(raw);
    if ("problem" in r) {
      setProblem(r.problem);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api(`/api/companies/${detail.id}`, { method: "PATCH", body: { cms: { siteUrl: r.url } } });
      setValue(r.url);
      toast(r.url ? "EmDash address saved." : "EmDash address removed.");
      await onChanged();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      data-cms-settings=""
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
    >
      {problem && <Notice tone="error">{problem}</Notice>}
      <div className="grid gap-2 rounded-lg border p-3">
        <Label htmlFor="cms-url">EmDash site address</Label>
        <Input
          id="cms-url"
          type="url"
          inputMode="url"
          placeholder="https://cms.example.com"
          maxLength={SITE_URL_MAX}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          Type the address of your EmDash site. The CMS page opens its admin at <code className="font-mono text-xs">{ADMIN_PATH}</code>. People sign in to
          EmDash with their EmDash account.
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || value.trim() === saved}>
            Save
          </Button>
          {saved && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void save("")}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <Notice tone="info">
        The EmDash site must allow this OpenAct site to show it in a frame. If the page stays blank, add this site to the frame-ancestors rule of the EmDash
        site, or use Open in new tab.
      </Notice>
      <p className="text-xs text-muted-foreground">Choose who sees the CMS page in the Permissions tab, under Open the CMS.</p>
    </form>
  );
}
