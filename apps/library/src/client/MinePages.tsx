import { useMemo, useRef, useState } from "react";
import { Field, Icon, Link, Notice, PageBody, SiteHeader, api, errorText, navigate, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Textarea } from "@openact/ui/components/textarea";
import { API, EMPTY_FIELDS, HOME, type LinkPreview, type Resource, type ResourceFields, type Term } from "../shared/rules";
import { reloadConfig, resourcePath, useLibrary, useMine } from "./state";
import { Card } from "./ReadPages";

/* My Library: what a person saved from the company library, and the private links, files and notes they added. Only they see it. */

type Tab = "all" | "saved" | "added";

export function MinePage() {
  const { config } = useLibrary();
  const { mine } = useMine();
  const [tab, setTab] = useState<Tab>("all");
  const byId = useMemo(() => new Map((config?.terms ?? []).map((t): [string, Term] => [t.id, t])), [config?.terms]);
  if (!config) return null;
  const saved = mine?.saved ?? [];
  const added = mine?.added ?? [];
  const shown: Resource[] = tab === "saved" ? saved : tab === "added" ? added : [...added, ...saved];
  const tabs: Array<[Tab, string, number]> = [
    ["all", "All", saved.length + added.length],
    ["saved", "Saved", saved.length],
    ["added", "Added by me", added.length]
  ];
  return (
    <>
      <SiteHeader title="My Library">
        <Button size="sm" className="ml-auto" asChild>
          <Link to={`${HOME}/mine/add`}>
            <Icon name="plus" />
            Add to My Library
          </Link>
        </Button>
      </SiteHeader>
      <PageBody className="max-w-6xl">
        <h1 className="text-2xl font-semibold tracking-tight">My Library</h1>
        <p className="text-sm text-muted-foreground">Resources you saved from the company library, and your own private links, files and notes. Search reads them too. Only you see this page.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {tabs.map(([t, label, n]) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} aria-pressed={tab === t} className="rounded-full" onClick={() => setTab(t)}>
              {label} {n}
            </Button>
          ))}
        </div>
        {mine && shown.length === 0 && (
          <div className="grid justify-items-start gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            <span>
              {tab === "added"
                ? "You have not added anything yet."
                : "Nothing saved yet. Select the bookmark on a resource in the company library to save it here."}
            </span>
            <Button size="sm" variant="outline" asChild>
              <Link to={tab === "added" ? `${HOME}/mine/add` : HOME}>{tab === "added" ? "Add to My Library" : "Open the company library"}</Link>
            </Button>
          </div>
        )}
        {shown.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="My Library">
            {shown.map((r) => (
              <Card key={r.id} r={r} byId={byId} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

export function MineAddPage() {
  const { config, companyId } = useLibrary();
  const { reload } = useMine();
  const toast = useToast();
  const [link, setLink] = useState("");
  const [f, setF] = useState<ResourceFields | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = `${API}/companies/${companyId}/mine`;

  const done = (r: Resource, what: string) => {
    toast(what);
    reload();
    reloadConfig();
    navigate(resourcePath(r.id));
  };

  async function read() {
    if (!link.trim()) return;
    setBusy("read");
    setError(null);
    try {
      const p = await api<LinkPreview>(`${base}/preview`, { body: { url: link.trim() } });
      setF({ ...EMPTY_FIELDS, format: p.format, title: p.title, summary: p.summary, sourceUrl: p.sourceUrl, imageUrl: p.imageUrl, siteName: p.siteName });
    } catch (e) {
      // A page that does not answer can still be saved with a title you type.
      setF({ ...EMPTY_FIELDS, format: "link", title: "", sourceUrl: link.trim() });
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await api<{ item: Resource }>(`${base}/files`, { method: "POST", form });
      done(r.item, `Added ${file.name} to My Library.`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  async function save() {
    if (!f) return;
    setBusy("save");
    setError(null);
    try {
      const r = await api<{ item: Resource }>(base, { body: { fields: f } });
      done(r.item, `Added "${r.item.title}" to My Library.`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  if (!config || !companyId) return null;
  return (
    <>
      <SiteHeader title="Add to My Library" />
      <PageBody className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Add to My Library</h1>
        <p className="text-sm text-muted-foreground">Only you see what you add here. The company library does not change.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-2">
          <label htmlFor="mine-link" className="text-sm font-medium">
            Paste a link, or upload a file
          </label>
          <form
            className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void read();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) void upload(file);
            }}
          >
            <Input id="mine-link" type="url" value={link} placeholder="https://" onChange={(e) => setLink(e.target.value)} className="min-w-64 flex-1 bg-background" />
            <Button type="submit" disabled={!link.trim() || !!busy}>
              {busy === "read" ? "Reading…" : "Read the link"}
            </Button>
            <Button type="button" variant="outline" disabled={!!busy} onClick={() => fileInput.current?.click()}>
              <Icon name="upload" />
              {busy === "upload" ? "Uploading…" : "Upload a file"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.mp4,.webm,.mov"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </form>
          {!f && (
            <button type="button" className="justify-self-start text-sm text-primary underline" onClick={() => setF({ ...EMPTY_FIELDS, format: "article" })}>
              Or write a note
            </button>
          )}
        </div>
        {f && (
          <div className="grid gap-4 rounded-xl border p-4 sm:p-5">
            <Field label="Title" htmlFor="mine-title">
              <Input id="mine-title" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            {f.format === "article" ? (
              <Field label="Note" htmlFor="mine-body" help="Plain text. Leave a blank line between paragraphs.">
                <Textarea id="mine-body" rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
              </Field>
            ) : (
              <Field label="Note (optional)" htmlFor="mine-summary">
                <Textarea id="mine-summary" rows={3} value={f.summary} maxLength={1000} onChange={(e) => setF({ ...f, summary: e.target.value })} />
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!!busy || !f.title.trim() || (f.format === "article" && !f.body.trim())} onClick={() => void save()}>
                {busy === "save" ? "Adding…" : "Add to My Library"}
              </Button>
              <Button variant="outline" onClick={() => setF(null)} disabled={!!busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">To save a company resource, select the bookmark on its card or Save on its page.</p>
      </PageBody>
    </>
  );
}
