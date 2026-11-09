import { useCallback, useEffect, useState } from "react";
import {
  COMPANY_AI_MODELS,
  COMPANY_AI_PROVIDERS,
  COMPANY_AI_PROVIDER_LABELS,
  aiModelLabel,
  type CompanyAiProvider,
  type CompanyAiSettings
} from "@openact/core/shared";
import { api, errorText } from "../api";
import { ConfirmButton, Field, Notice, useToast } from "../ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";

type Choice = CompanyAiProvider | "default";

const PROVIDER_LINKS: Record<CompanyAiProvider, { url: string; name: string }> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", name: "console.anthropic.com" }
};

/** Company settings, AI provider tab. Owners choose the AI agent and paste their API key. Admins can only look. */
export function CompanyAiTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [s, setS] = useState<CompanyAiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("default");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const apply = (next: CompanyAiSettings) => {
    setS(next);
    setChoice(next.provider);
    setModel(next.model ?? (next.provider === "default" ? "" : COMPANY_AI_MODELS[next.provider][0].id));
    setKey("");
  };

  const load = useCallback(async () => {
    try {
      apply(await api<CompanyAiSettings>(`/api/companies/${companyId}/ai`));
    } catch (e) {
      setError(errorText(e));
    }
  }, [companyId]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const deployLabel = s.deployDefault.model ? `${s.deployDefault.provider}, ${aiModelLabel(s.deployDefault.model)}` : s.deployDefault.provider;
  const sameProvider = choice !== "default" && s.provider === choice;
  const keepsKey = sameProvider && !!s.keyHint && !s.keyBroken;

  const pick = (v: Choice) => {
    setChoice(v);
    setFormError(null);
    if (v !== "default") setModel(s.provider === v && s.model ? s.model : COMPANY_AI_MODELS[v][0].id);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (choice === "default") return;
    setBusy(true);
    setFormError(null);
    try {
      apply(await api<CompanyAiSettings>(`/api/companies/${companyId}/ai`, { method: "PUT", body: { provider: choice, model, apiKey: key.trim() || null } }));
      toast("The key works. The AI provider is saved.");
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const useDefault = async () => {
    setBusy(true);
    setFormError(null);
    try {
      apply(await api<CompanyAiSettings>(`/api/companies/${companyId}/ai`, { method: "DELETE" }));
      toast("The company uses the deploy default now. The saved key is deleted.");
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const current =
    s.provider === "default" ? (
      <>
        This company uses the deploy default: <span className="font-medium text-foreground">{deployLabel}</span>.
      </>
    ) : (
      <>
        This company uses <span className="font-medium text-foreground">{aiModelLabel(s.model ?? "")}</span> with its own API key, ending in{" "}
        <span className="font-mono text-foreground">{s.keyHint}</span>.
      </>
    );

  if (!s.canEdit) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">{current}</p>
        <Notice tone="info">Only a company owner can change the AI provider, because the API key bills the company.</Notice>
      </div>
    );
  }

  const link = choice !== "default" ? PROVIDER_LINKS[choice] : null;
  const models = choice !== "default" ? COMPANY_AI_MODELS[choice] : [];

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">{current}</p>
      {s.keyBroken && (
        <Notice tone="warn">
          This deploy cannot read the saved key, so the deploy default runs. This happens when the server secret changes. Paste the key again.
        </Notice>
      )}
      <form className="grid gap-5" onSubmit={save}>
        <Field label="Provider" htmlFor="ai-provider" help="The agent, task drafts and summaries in every project of this company use this AI.">
          <NativeSelect id="ai-provider" value={choice} onChange={(e) => pick(e.target.value as Choice)}>
            <NativeSelectOption value="default">Deploy default ({deployLabel})</NativeSelectOption>
            {COMPANY_AI_PROVIDERS.map((p) => (
              <NativeSelectOption key={p} value={p}>
                {COMPANY_AI_PROVIDER_LABELS[p]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        {choice !== "default" && (
          <>
            <Field label="Model" htmlFor="ai-model" help={models.find((m) => m.id === model)?.help}>
              <NativeSelect id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m, i) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.label}
                    {i === 0 ? " (recommended)" : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="API key"
              htmlFor="ai-key"
              help={
                <>
                  Make a key at{" "}
                  <a href={link?.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {link?.name}
                  </a>
                  . Your company pays the provider for each request. The key is encrypted on the server, and nobody can see it again. Requests go through this deploy's
                  Cloudflare AI Gateway.
                </>
              }
            >
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                maxLength={300}
                onChange={(e) => setKey(e.target.value)}
                placeholder={keepsKey ? `Saved key ending in ${s.keyHint}. Leave empty to keep it.` : "sk-ant-..."}
              />
            </Field>
          </>
        )}

        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {s.provider !== "default" && (
            <ConfirmButton
              label="Use the deploy default"
              confirmLabel="Click again to delete the key and use the deploy default"
              onConfirm={useDefault}
              disabled={busy}
              size="default"
            />
          )}
          {choice !== "default" && (
            <Button type="submit" disabled={busy || (!key.trim() && !keepsKey)}>
              {busy ? "Testing the key…" : "Test and save"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
