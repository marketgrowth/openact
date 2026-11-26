import { useEffect, useState } from "react";
import { AgentState, Field, Icon, Link, Notice, PageBody, SiteHeader, api, errorText, navigate, useToast } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";
import {
  API,
  AUTOMATION_LABEL,
  EVERY_CHOICES,
  EVERY_LABEL,
  HOME,
  TERM_KINDS,
  type Automation,
  type AutomationKind,
  type FeedPreview,
  type ManageState,
  type Run,
  type TermKind
} from "../shared/rules";
import { ago, fmtDate, reloadConfig, useLibrary, useManage } from "./state";

/* Automations: feeds, video channels and webhooks that add resources, and the log of their runs. Super admins only. */

const KIND_ICON: Record<AutomationKind, string> = { feed: "website", video_channel: "video", webhook: "send" };

function termNames(state: ManageState | null, ids: string[]): string {
  if (!state) return "";
  return ids
    .map((id) => state.terms.find((t) => t.id === id)?.name)
    .filter(Boolean)
    .join(" · ");
}

/** The webhook address for a key. The full key shows once, when it is made. */
const hookUrl = (key: string) => `${location.origin}${API}/inbound/${key}`;

function KeyNotice({ k, onDone }: { k: string; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/40 p-4 text-sm" role="status">
      <span className="font-medium">Copy the webhook address now. It shows only once.</span>
      <code className="break-all rounded-md bg-background px-3 py-2 text-xs">POST {hookUrl(k)}</code>
      <code className="rounded-md bg-background px-3 py-2 text-xs">{`{ "url": "https://example.com/post", "type": "News", "topics": ["Marketing"] }`}</code>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(hookUrl(k)).then(() => toast("Copied the address."));
          }}
        >
          Copy the address
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function AutomationsPage() {
  const { config } = useLibrary();
  const { state } = useManage(config?.isSiteOwner ? `${API}/manage` : null);
  const toast = useToast();
  const [list, setList] = useState<Automation[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const load = () =>
    api<{ automations: Automation[]; runs: Run[] }>(`${API}/manage/automations`).then(
      (r) => {
        setList(r.automations);
        setRuns(r.runs);
      },
      (e) => setError(errorText(e))
    );
  useEffect(() => {
    if (config?.isSiteOwner) void load();
  }, [config?.isSiteOwner]);

  async function act(a: Automation, what: "run" | "pause" | "resume" | "key" | "delete" | "publish") {
    setBusy(a.id);
    setError(null);
    try {
      if (what === "run") {
        const r = await api<{ run: Run | null }>(`${API}/manage/automations/${a.id}/run`, { method: "POST" });
        toast(r.run?.error || r.run?.note || "Done.");
        reloadConfig();
      } else if (what === "key") {
        if (!confirm(`Make a new key for "${a.name}"? The old address stops working at once.`)) return;
        const r = await api<{ key: string }>(`${API}/manage/automations/${a.id}/key`, { method: "POST" });
        setKey(r.key);
      } else if (what === "delete") {
        if (!confirm(`Delete "${a.name}"? Resources it added stay in the library.`)) return;
        await api(`${API}/manage/automations/${a.id}`, { method: "DELETE" });
        toast("Deleted.");
      } else {
        const body = what === "publish" ? { autoPublish: !a.autoPublish } : { paused: what === "pause" };
        await api(`${API}/manage/automations/${a.id}`, { method: "PATCH", body });
      }
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!config) return null;
  if (!config.isSiteOwner)
    return (
      <PageBody>
        <Notice>Only a site owner can manage automations.</Notice>
      </PageBody>
    );
  return (
    <>
      <SiteHeader title="Automations">
        <Button size="sm" className="ml-auto" asChild>
          <Link to={`${HOME}/vault/automations/new`}>
            <Icon name="plus" />
            New automation
          </Link>
        </Button>
      </SiteHeader>
      <PageBody className="max-w-6xl">
        <p className="text-sm text-muted-foreground">Automations add resources for you. New items wait in To review, unless the automation publishes them to the Content Vault.</p>
        {error && <Notice tone="error">{error}</Notice>}
        {key && (
          <KeyNotice k={key} onDone={() => setKey(null)} />
        )}
        {list && list.length === 0 && (
          <div className="grid justify-items-start gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            <span>No automations yet. Add a feed, a video channel or a webhook.</span>
            <Button size="sm" asChild>
              <Link to={`${HOME}/vault/automations/new`}>New automation</Link>
            </Button>
          </div>
        )}
        {list && list.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-xl border" aria-label="Automations">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-3" data-automation={a.id}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
                  <Icon name={KIND_ICON[a.kind]} size={16} />
                </span>
                <div className="grid min-w-0 flex-[1_1_16rem] gap-0.5">
                  <span className="font-medium">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {AUTOMATION_LABEL[a.kind]} · {a.kind === "webhook" ? `key …${a.keyLast4}` : a.url.replace(/^https:\/\//, "")}
                  </span>
                </div>
                <span className="min-w-28 text-sm text-muted-foreground">{termNames(state, a.termIds) || "No tags"}</span>
                <Badge variant={a.autoPublish ? "default" : "secondary"} className="font-normal">
                  {a.autoPublish ? "Publishes" : "To review"}
                </Badge>
                <span className="min-w-36 text-sm text-muted-foreground">
                  {a.lastError ? <span className="text-destructive">{a.lastError}</span> : `${ago(a.lastRunAt)}${a.lastNote ? ` · ${a.lastNote}` : ""}`}
                </span>
                <Badge variant={a.paused ? "outline" : "secondary"} className="font-normal">
                  {a.paused ? "Paused" : "On"}
                </Badge>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {a.kind !== "webhook" && (
                    <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => void act(a, "run")}>
                      Run now
                    </Button>
                  )}
                  {a.kind === "webhook" && (
                    <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => void act(a, "key")}>
                      New key
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => void act(a, "publish")}>
                    {a.autoPublish ? "Send to To review" : "Publish new items"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => void act(a, a.paused ? "resume" : "pause")}>
                    {a.paused ? "Turn on" : "Pause"}
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${a.name}`} disabled={busy === a.id} onClick={() => void act(a, "delete")}>
                    <Icon name="trash" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {runs.length > 0 && (
          <section aria-label="Recent runs" className="overflow-hidden rounded-xl border">
            <h2 className="px-4 py-3 text-sm font-medium">Recent runs</h2>
            <ul className="divide-y text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-2.5">
                  <span className="w-28 text-muted-foreground">{ago(r.ranAt)}</span>
                  <span className="w-44 truncate">{r.automationName}</span>
                  <span className={r.error ? "text-destructive" : "text-muted-foreground"}>{r.error || r.note}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-sm text-muted-foreground">
          AI agents can search the library and add drafts with the tools <code>library_search</code> and <code>library_add_draft</code>, when agent access is on for this site.
          A person publishes what an agent adds.
        </p>
      </PageBody>
    </>
  );
}

const SOURCES: Array<{ kind: AutomationKind; title: string; help: string }> = [
  { kind: "feed", title: "Feed or blog", help: "An RSS or Atom feed, or a blog address. New posts come in as links." },
  { kind: "video_channel", title: "Video channel", help: "A YouTube channel. New videos come in and play in the page." },
  { kind: "webhook", title: "Webhook", help: "Any tool posts a link to a private address: a form, a sheet, a workflow app." }
];

export function NewAutomationPage() {
  const { config } = useLibrary();
  const { state } = useManage(config?.isSiteOwner ? `${API}/manage` : null);
  const toast = useToast();
  const [kind, setKind] = useState<AutomationKind>("feed");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [name, setName] = useState("");
  const [every, setEvery] = useState(60);
  const [terms, setTerms] = useState<Record<TermKind, string>>({ type: "", topic: "", audience: "" });
  const [autoPublish, setAutoPublish] = useState(false);
  const [startWith, setStartWith] = useState(true);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy("check");
    setError(null);
    setPreview(null);
    try {
      const p = await api<FeedPreview>(`${API}/manage/automations/preview`, { body: { kind, url } });
      setPreview(p);
      if (!name) setName(p.feedTitle || "");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const r = await api<{ automation: Automation; key: string }>(`${API}/manage/automations`, {
        body: {
          kind,
          name,
          url: kind === "webhook" ? undefined : url,
          everyMinutes: every,
          termIds: Object.values(terms).filter(Boolean),
          autoPublish,
          startWith: kind !== "webhook" && startWith ? (preview?.entries.length ?? 0) : 0
        }
      });
      toast(`Turned on "${r.automation.name}".`);
      reloadConfig();
      // A webhook key shows once, here. Other automations go back to the list.
      if (r.key) {
        setCreatedKey(r.key);
        setBusy(null);
      } else navigate(`${HOME}/vault/automations`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  if (!config) return null;
  if (!config.isSiteOwner)
    return (
      <PageBody>
        <Notice>Only a site owner can manage automations.</Notice>
      </PageBody>
    );
  const ready = !!name.trim() && (kind === "webhook" || !!preview);
  if (createdKey)
    return (
      <>
        <SiteHeader title="New automation" />
        <PageBody className="max-w-4xl">
          <KeyNotice k={createdKey} onDone={() => navigate(`${HOME}/vault/automations`)} />
        </PageBody>
      </>
    );
  return (
    <>
      <SiteHeader
        title={
          <span className="flex items-center gap-2">
            <Link to={`${HOME}/vault/automations`} className="text-muted-foreground no-underline hover:text-foreground">
              Automations
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <span>New automation</span>
          </span>
        }
      />
      <PageBody className="max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">New automation</h1>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Where do new resources come from?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SOURCES.map((s) => (
              <label
                key={s.kind}
                className={`grid cursor-pointer gap-1.5 rounded-xl border p-3.5 ${kind === s.kind ? "border-primary ring-1 ring-primary" : "hover:bg-accent"}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name="source"
                    className="size-4 accent-primary"
                    checked={kind === s.kind}
                    onChange={() => {
                      setKind(s.kind);
                      setPreview(null);
                      setError(null);
                    }}
                  />
                  <Icon name={KIND_ICON[s.kind]} size={16} />
                  {s.title}
                </span>
                <span className="text-sm text-muted-foreground">{s.help}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {kind !== "webhook" && (
          <div className="grid gap-3">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void check();
              }}
            >
              <Field label={kind === "feed" ? "Feed or blog address" : "YouTube channel address"} htmlFor="a-url" className="min-w-64 flex-1">
                <Input
                  id="a-url"
                  type="url"
                  value={url}
                  placeholder={kind === "feed" ? "https://example.com/feed.xml" : "https://www.youtube.com/@example"}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setPreview(null);
                  }}
                />
              </Field>
              <Button type="submit" variant="outline" disabled={!url.trim() || !!busy}>
                {busy === "check" ? "Checking…" : "Check"}
              </Button>
            </form>
            {busy === "check" && <AgentState state="act">Looking for the feed…</AgentState>}
            {preview && (
              <div className="overflow-hidden rounded-xl border">
                <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-primary">
                  <Icon name="check" size={15} />
                  Found “{preview.feedTitle || preview.feedUrl}”. Latest {preview.entries.length} entr{preview.entries.length === 1 ? "y" : "ies"}:
                </p>
                <ul className="divide-y border-t text-sm">
                  {preview.entries.map((e) => (
                    <li key={e.url} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon name={kind === "video_channel" ? "video" : "link"} size={14} />
                        <span className="truncate">{e.title}</span>
                      </span>
                      <span className="text-muted-foreground">{fmtDate(e.date)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <Field label="Name" htmlFor="a-name" className="min-w-64 flex-[2_1_16rem]">
            <Input id="a-name" value={name} maxLength={80} placeholder={kind === "webhook" ? "For example: Partner form" : "For example: Industry news"} onChange={(e) => setName(e.target.value)} />
          </Field>
          {kind !== "webhook" && (
            <Field label="Check" htmlFor="a-every" className="flex-[1_1_12rem]">
              <NativeSelect id="a-every" value={String(every)} onChange={(e) => setEvery(Number(e.target.value))}>
                {EVERY_CHOICES.map((m) => (
                  <NativeSelectOption key={m} value={String(m)}>
                    {EVERY_LABEL[m]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
        {state && (
          <div className="flex flex-wrap gap-4">
            {TERM_KINDS.filter((k) => state.settings.lists[k].on).map((k) => (
              <Field key={k} label={`Add as ${state.settings.lists[k].label.toLowerCase()}`} htmlFor={`a-${k}`} className="flex-[1_1_12rem]">
                <NativeSelect id={`a-${k}`} value={terms[k]} onChange={(e) => setTerms({ ...terms, [k]: e.target.value })}>
                  <NativeSelectOption value="">None</NativeSelectOption>
                  {state.terms
                    .filter((t) => t.kind === k && !t.isHidden)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {t.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
            ))}
          </div>
        )}
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Then</legend>
          {[
            { v: false, title: "Put each new item in To review", help: "A manager publishes it, edits it or dismisses it." },
            { v: true, title: "Publish each new item", help: "Use this only for a source you trust, such as your own blog." }
          ].map((o) => (
            <label key={String(o.v)} className="flex cursor-pointer items-start gap-3 text-sm">
              <input type="radio" name="then" className="mt-0.5 size-4 accent-primary" checked={autoPublish === o.v} onChange={() => setAutoPublish(o.v)} />
              <span className="grid gap-0.5">
                <span className="font-medium">{o.title}</span>
                <span className="text-muted-foreground">{o.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {kind !== "webhook" && preview && preview.entries.length > 0 && (
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={startWith} onCheckedChange={setStartWith} />
            Start with the {preview.entries.length} entries above. Off: only entries newer than these come in.
          </label>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!ready || !!busy} onClick={() => void create()}>
            {busy === "create" ? "Turning on…" : "Turn on"}
          </Button>
          <Button variant="outline" asChild>
            <Link to={`${HOME}/vault/automations`}>Cancel</Link>
          </Button>
          {kind !== "webhook" && !preview && <span className="self-center text-xs text-muted-foreground">Check the address first.</span>}
        </div>
      </PageBody>
    </>
  );
}
