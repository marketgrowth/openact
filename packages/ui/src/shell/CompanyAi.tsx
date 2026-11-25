import { useCallback, useEffect, useState } from "react";
import {
  AI_KEY_LINKS,
  AI_KEY_NOTICE,
  COMPANY_AI_MODELS,
  COMPANY_AI_PROVIDERS,
  COMPANY_AI_PROVIDER_LABELS,
  COMPANY_KEY_INFO,
  aiModelLabel,
  type CompanyAiProvider,
  type CompanyAiSettings,
  type CompanyKeySettings,
  type UserAiSettings
} from "@openact/core/shared";
import { api, errorText } from "../api";
import { ConfirmButton, Field, Notice, useToast } from "../ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";

/*
 * Bring your own AI.
 * Company settings, AI provider tab: owners choose the company AI and if members can use their own key. Admins can only look.
 * Personal account, My AI: each person can use their own provider, model and key.
 * A partner and its client companies bring their own AI (docs/partners.md): the page says whose key runs, and the
 * deploy default is not offered to them.
 */

type Choice = CompanyAiProvider | "default";

/** The facts every key form shows: who pays, and that AI output needs a check. */
export function AiKeyNotice() {
  return (
    <Notice tone="warn" className="grid gap-1">
      {AI_KEY_NOTICE.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </Notice>
  );
}

/** The saved state that the form shows. */
interface Saved {
  provider: Choice;
  model: string | null;
  keyHint: string | null;
  keyBroken: boolean;
}

/** Provider, model and key, with Test and save. Used for the company AI and for a person's own AI. */
function AiChoiceForm({
  saved,
  defaultLabel,
  providerHelp,
  payer,
  onSave,
  onClear,
  clearLabel
}: {
  saved: Saved;
  /** What "default" means here, such as "Deploy default (workers-ai)". */
  defaultLabel: string;
  providerHelp: string;
  /** Who pays the provider, such as "Your company" or "You". */
  payer: string;
  onSave: (provider: CompanyAiProvider, model: string, apiKey: string | null) => Promise<void>;
  onClear: () => Promise<void>;
  clearLabel: string;
}) {
  const [choice, setChoice] = useState<Choice>(saved.provider);
  const [model, setModel] = useState(saved.model ?? (saved.provider === "default" ? "" : COMPANY_AI_MODELS[saved.provider][0].id));
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setChoice(saved.provider);
    setModel(saved.model ?? (saved.provider === "default" ? "" : COMPANY_AI_MODELS[saved.provider][0].id));
    setKey("");
  }, [saved]);

  const keepsKey = choice !== "default" && saved.provider === choice && !!saved.keyHint && !saved.keyBroken;

  const pick = (v: Choice) => {
    setChoice(v);
    setFormError(null);
    if (v !== "default") setModel(saved.provider === v && saved.model ? saved.model : COMPANY_AI_MODELS[v][0].id);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (choice === "default") return;
    run(() => onSave(choice, model, key.trim() || null));
  };

  const link = choice !== "default" ? AI_KEY_LINKS[choice] : null;
  const models = choice !== "default" ? COMPANY_AI_MODELS[choice] : [];

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <Field label="Provider" htmlFor="ai-provider" help={providerHelp}>
        <NativeSelect id="ai-provider" value={choice} onChange={(e) => pick(e.target.value as Choice)}>
          <NativeSelectOption value="default">{defaultLabel}</NativeSelectOption>
          {COMPANY_AI_PROVIDERS.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {COMPANY_AI_PROVIDER_LABELS[p]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      {choice !== "default" && link && (
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
                <a href={link.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {link.name}
                </a>
                . {payer} pays the provider for each request. The key is encrypted on the server, and nobody can see it again. Requests go through this deploy's
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
              placeholder={keepsKey ? `Saved key ending in ${saved.keyHint}. Leave empty to keep it.` : link.placeholder}
            />
          </Field>
          <AiKeyNotice />
        </>
      )}

      {formError && <Notice tone="error">{formError}</Notice>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {saved.provider !== "default" && (
          <ConfirmButton label={clearLabel} confirmLabel={`Click again to delete the key. ${clearLabel}.`} onConfirm={() => run(onClear)} disabled={busy} size="default" />
        )}
        {choice !== "default" && (
          <Button type="submit" disabled={busy || (!key.trim() && !keepsKey)}>
            {busy ? "Testing the key…" : "Test and save"}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Company settings, AI provider tab. */
export function CompanyAiTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [s, setS] = useState<CompanyAiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await api<CompanyAiSettings>(`/api/companies/${companyId}/ai`));
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
  // A partner and its clients never use the deploy default. Say whose AI runs instead.
  const own = s.partner?.ownAiRequired ? s.partner : null;
  const partnerAi = own?.isClient ? own.partnerAi : null;
  const defaultLabel = own ? (partnerAi ? `${own.name}'s AI (${aiModelLabel(partnerAi.model)})` : "No AI (add a key)") : `Deploy default (${deployLabel})`;

  const current =
    s.provider !== "default" ? (
      <>
        This company uses <span className="font-medium text-foreground">{aiModelLabel(s.model ?? "")}</span> with its own API key, ending in{" "}
        <span className="font-mono text-foreground">{s.keyHint}</span>.
      </>
    ) : !own ? (
      <>
        This company uses the deploy default: <span className="font-medium text-foreground">{deployLabel}</span>.
      </>
    ) : partnerAi ? (
      <>
        This company uses <span className="font-medium text-foreground">{aiModelLabel(partnerAi.model)}</span> with the API key of {own.name}. {own.name} pays the
        provider. Add the company's own key below to use it instead.
      </>
    ) : own.isClient ? (
      <>
        This company has no AI yet. {own.name} provides the AI for its clients, but has not added a key. Ask {own.name}, or add the company's own key below.
      </>
    ) : (
      <>
        Your company has no AI key yet, so AI features are off. This site does not provide AI for partners. Add your key below. Your client companies use it too,
        unless they add their own.
      </>
    );

  const memberLine = s.memberKeys
    ? "Members can use their own AI key. Their own key replaces this setting for their requests."
    : "Members cannot use their own AI key. Everyone in this company uses this setting.";

  if (!s.canEdit) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">{current}</p>
        <p className="text-sm text-muted-foreground">{memberLine}</p>
        <Notice tone="info">Only a company owner can change the AI provider, because the API key bills the company.</Notice>
        <CompanyKeysSection companyId={companyId} />
      </div>
    );
  }

  const setMemberKeys = async (allow: boolean) => {
    setSwitching(true);
    try {
      setS(await api<CompanyAiSettings>(`/api/companies/${companyId}/ai/member-keys`, { method: "PUT", body: { allow } }));
      toast(allow ? "Members can use their own AI key now." : "Members use the company AI now. Their own keys do not run in this company.");
    } catch (err) {
      toast(errorText(err));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">{current}</p>
      {s.keyBroken && (
        <Notice tone="warn">
          This deploy cannot read the saved key, so {own ? "it does not run" : "the deploy default runs"}. This happens when the server secret changes. Paste the key
          again.
        </Notice>
      )}
      <AiChoiceForm
        saved={s}
        defaultLabel={defaultLabel}
        providerHelp="The agent, task drafts and summaries in every project of this company use this AI, unless a member uses their own key."
        payer="Your company"
        clearLabel={own ? "Remove the company's key" : "Use the deploy default"}
        onSave={async (provider, model, apiKey) => {
          setS(await api<CompanyAiSettings>(`/api/companies/${companyId}/ai`, { method: "PUT", body: { provider, model, apiKey } }));
          toast("The key works. The AI provider is saved.");
        }}
        onClear={async () => {
          setS(await api<CompanyAiSettings>(`/api/companies/${companyId}/ai`, { method: "DELETE" }));
          toast(own ? "The saved key is deleted." : "The company uses the deploy default now. The saved key is deleted.");
        }}
      />
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="grid gap-1">
          <span className="text-sm font-medium">Members can use their own AI key</span>
          <span className="text-xs text-muted-foreground">
            A member's own key sends their requests, with the company's project data, to their own provider account. Turn this off to keep all AI requests on the
            company AI.
          </span>
        </div>
        <Switch checked={s.memberKeys} disabled={switching} onCheckedChange={setMemberKeys} aria-label="Members can use their own AI key" />
      </div>
      <CompanyKeysSection companyId={companyId} />
    </div>
  );
}

/** Keys for other services, such as TypeSafe (Jev). Owners change them. Admins can only look. */
function CompanyKeysSection({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [s, setS] = useState<CompanyKeySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<CompanyKeySettings>(`/api/companies/${companyId}/keys`).then(setS, (e) => setError(errorText(e)));
  }, [companyId]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!s) return null;

  const save = async (service: string, remove: boolean) => {
    setBusy(service);
    try {
      const path = `/api/companies/${companyId}/keys/${service}`;
      setS(await api<CompanyKeySettings>(path, remove ? { method: "DELETE" } : { method: "PUT", body: { apiKey: draft[service] ?? "" } }));
      setDraft((d) => ({ ...d, [service]: "" }));
      toast(remove ? "The key is deleted." : "The key is saved.");
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 border-t pt-6" data-company-keys="">
      <h3 className="text-sm font-medium">Other services</h3>
      {s.keys.map((k) => {
        const info = COMPANY_KEY_INFO[k.service];
        const status =
          k.source === "company"
            ? `On, with this company's key, ending in ${k.keyHint}.`
            : k.source === "partner"
              ? `On, with the key of ${s.partnerName}.`
              : k.source === "deploy"
                ? "On, with this site's key."
                : "Off. Add a key to turn it on.";
        return (
          <div key={k.service} className="grid gap-3 rounded-md border p-3">
            <div className="grid gap-1">
              <span className="text-sm font-medium">{info.label}</span>
              <span className="text-xs text-muted-foreground">{info.use}</span>
              <span className="text-xs text-muted-foreground">{status}</span>
            </div>
            {k.keyBroken && <Notice tone="warn">This deploy cannot read the saved key. Paste the key again.</Notice>}
            {s.canEdit && (
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(k.service, false);
                }}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={300}
                  aria-label={`${info.label} API key`}
                  className="sm:flex-1"
                  placeholder={k.keyHint ? `Saved key ending in ${k.keyHint}. Paste a new one to replace it.` : `Paste a key from ${info.name}`}
                  value={draft[k.service] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [k.service]: e.target.value }))}
                />
                <Button type="submit" disabled={busy === k.service || !(draft[k.service] ?? "").trim()}>
                  Save
                </Button>
                {k.keyHint && (
                  <ConfirmButton label="Delete" confirmLabel="Click again to delete the key" onConfirm={() => save(k.service, true)} disabled={busy === k.service} size="default" />
                )}
              </form>
            )}
            {s.canEdit && (
              <p className="text-xs text-muted-foreground">
                Make a key at{" "}
                <a href={info.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {info.name}
                </a>
                . Your company pays for each request. The key is encrypted on the server, and nobody can see it again.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Personal account, My AI. */
export function MyAiSection() {
  const toast = useToast();
  const [s, setS] = useState<UserAiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setS(await api<UserAiSettings>("/api/me/ai"));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-6" data-account-ai="">
      <p className="text-sm text-muted-foreground">
        {s.provider === "default" ? (
          <>You use the AI that each company chose. If a company chose none, you use the deploy default.</>
        ) : (
          <>
            You use <span className="font-medium text-foreground">{aiModelLabel(s.model ?? "")}</span> with your own API key, ending in{" "}
            <span className="font-mono text-foreground">{s.keyHint}</span>. It replaces the company AI in every company that allows it.
          </>
        )}
      </p>
      {s.keyBroken && <Notice tone="warn">This deploy cannot read your saved key, so the company AI runs. This happens when the server secret changes. Paste the key again.</Notice>}
      {s.blockedIn.length > 0 && (
        <Notice tone="info">
          {s.blockedIn.join(", ")} {s.blockedIn.length === 1 ? "does" : "do"} not allow personal keys. Your key does not run there. The company AI runs instead.
        </Notice>
      )}
      <AiChoiceForm
        saved={s}
        defaultLabel="The company AI (no key of my own)"
        providerHelp="The agent, task drafts and summaries use this AI for your requests, in every company that allows personal keys."
        payer="You"
        clearLabel="Use the company AI"
        onSave={async (provider, model, apiKey) => {
          setS(await api<UserAiSettings>("/api/me/ai", { method: "PUT", body: { provider, model, apiKey } }));
          toast("The key works. Your AI is saved.");
        }}
        onClear={async () => {
          setS(await api<UserAiSettings>("/api/me/ai", { method: "DELETE" }));
          toast("You use the company AI now. Your saved key is deleted.");
        }}
      />
    </div>
  );
}
