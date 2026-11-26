import { useEffect, useRef, useState } from "react";
import { Field, Icon, Link, Notice, PageBody, SiteHeader, api, errorText, navigate, useToast } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";
import { Textarea } from "@openact/ui/components/textarea";
import {
  API,
  EMPTY_FIELDS,
  FORMATS,
  FORMAT_LABEL,
  HOME,
  COMPANY_TABS,
  MANAGE_TABS,
  MANAGE_TAB_LABEL,
  MAX_SUGGESTIONS,
  ORIGIN_LABEL,
  STATUS_LABEL,
  TERM_KINDS,
  fileSizeLabel,
  publishProblem,
  type LinkPreview,
  type ManageCounts,
  type ManageState,
  type ManageTab,
  type Resource,
  type ResourceFields,
  type Settings,
  type Term,
  type TermKind
} from "../shared/rules";
import { FORMAT_ICON, ago, fileUrl, reloadConfig, resourcePath, useLibrary, useManage } from "./state";
import { ResourceMedia } from "./ReadPages";

/*
 * The manage pages, at two levels with the same screens:
 * - site: the Content Vault, for site owners (super admins). Its list has To review for automation drafts.
 * - company: one company's library, for people with library.manage.
 */

export type Level = "site" | "company";
type Base = { level: Level; api: string; home: string; allowed: boolean };

/** Where the API and the pages of a level live, and whether this person may use them. */
function useBase(level: Level): Base {
  const { config, companyId } = useLibrary();
  return level === "site"
    ? { level, api: `${API}/manage`, home: `${HOME}/vault`, allowed: !!config?.isSiteOwner }
    : { level, api: `${API}/companies/${companyId}/manage`, home: `${HOME}/manage`, allowed: !!config?.canManage && !!companyId };
}

function NoAccess({ level }: { level: Level }) {
  return (
    <PageBody>
      <Notice>{level === "site" ? "Only a site owner can manage the Content Vault." : "Only a company owner can manage the company library."}</Notice>
    </PageBody>
  );
}

function Origin({ r }: { r: Resource }) {
  if (r.origin === "person") return <span className="text-muted-foreground">Person</span>;
  return (
    <Badge variant="secondary" className="font-normal">
      {ORIGIN_LABEL[r.origin]}
      {r.automationName ? `: ${r.automationName}` : ""}
    </Badge>
  );
}

/* To review, Drafts, Published, Archived */

export function ManagePage({ level }: { level: Level }) {
  const { config } = useLibrary();
  const b = useBase(level);
  const tabs = level === "site" ? MANAGE_TABS : COMPANY_TABS;
  const toast = useToast();
  const [tab, setTab] = useState<ManageTab>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return (tabs as string[]).includes(t ?? "") ? (t as ManageTab) : tabs[0]!;
  });
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Resource[] | null>(null);
  const [counts, setCounts] = useState<ManageCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () =>
    api<{ items: Resource[]; counts: ManageCounts }>(`${b.api}/resources?tab=${tab}&q=${encodeURIComponent(q)}`).then(
      (r) => {
        setItems(r.items);
        setCounts(r.counts);
        setError(null);
      },
      (e) => setError(errorText(e))
    );
  useEffect(() => {
    if (!b.allowed) return;
    const t = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.allowed, b.api, tab, q]);

  async function act(r: Resource, action: "publish" | "unpublish" | "archive" | "restore" | "dismiss") {
    setBusy(r.id);
    try {
      if (action === "dismiss") await api(`${b.api}/resources/${r.id}`, { method: "DELETE" });
      else await api(`${b.api}/resources/${r.id}/${action}`, { method: "POST" });
      toast(action === "publish" ? `Published "${r.title}".` : action === "dismiss" ? `Dismissed "${r.title}".` : "Saved.");
      await load();
      reloadConfig();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!config) return null;
  if (!b.allowed) return <NoAccess level={level} />;
  return (
    <>
      <SiteHeader title={level === "site" ? "Content Vault" : "Company resources"}>
        <Button size="sm" className="ml-auto" asChild>
          <Link to={`${b.home}/add`}>
            <Icon name="plus" />
            {level === "site" ? "Add to Content Vault" : "Add resource"}
          </Link>
        </Button>
      </SiteHeader>
      <PageBody className="max-w-6xl">
        {level === "site" && <p className="text-sm text-muted-foreground">Templates for every company on the site. Members never see the vault.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {tabs.map((t) => (
              <Button
                key={t}
                role="tab"
                aria-selected={tab === t}
                variant="ghost"
                size="sm"
                className={tab === t ? "bg-background shadow-sm hover:bg-background" : "text-muted-foreground"}
                onClick={() => {
                  setTab(t);
                  history.replaceState(history.state, "", `${b.home}?tab=${t}`);
                }}
              >
                {MANAGE_TAB_LABEL[t]}
                {counts ? ` ${counts[t]}` : ""}
              </Button>
            ))}
          </div>
          <Input type="search" aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-56" />
        </div>
        {tab === "review" && <p className="text-sm text-muted-foreground">New resources from automations and AI agents wait here. Publish them, edit them, or dismiss them.</p>}
        {error && <Notice tone="error">{error}</Notice>}
        {items && items.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            {q ? "Nothing matches your search." : tab === "review" ? "Nothing to review. New items from automations show up here." : `No ${MANAGE_TAB_LABEL[tab].toLowerCase()} resources.`}
          </p>
        )}
        {items && items.length > 0 && (
          <div className="overflow-hidden rounded-xl border">
            <ul className="divide-y" aria-label={MANAGE_TAB_LABEL[tab]}>
              {items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-3" data-manage-row={r.id}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
                    <Icon name={FORMAT_ICON[r.format]} size={16} />
                  </span>
                  <div className="grid min-w-0 flex-[1_1_16rem] gap-0.5">
                    <Link to={`${b.home}/r/${r.id}`} className="truncate font-medium text-foreground no-underline hover:underline">
                      {r.title}
                    </Link>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{FORMAT_LABEL[r.format]}</span>
                      {r.siteName && <span>{r.siteName}</span>}
                      <span>{ago(r.updatedAt)}</span>
                    </span>
                  </div>
                  <div className="text-sm">
                    <Origin r={r} />
                  </div>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {r.status === "draft" && (
                      <Button size="sm" disabled={busy === r.id} onClick={() => void act(r, "publish")}>
                        Publish
                      </Button>
                    )}
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`${b.home}/r/${r.id}`}>Edit</Link>
                    </Button>
                    {tab === "review" && (
                      <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void act(r, "dismiss")}>
                        Dismiss
                      </Button>
                    )}
                    {r.status === "published" && (
                      <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void act(r, "archive")}>
                        Archive
                      </Button>
                    )}
                    {r.status === "archived" && (
                      <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void act(r, "restore")}>
                        Restore as draft
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PageBody>
    </>
  );
}

/* The fields of a resource */

function TagPicker({ b, state, kind, value, onChange }: { b: Base; state: ManageState; kind: TermKind; value: string[]; onChange: (ids: string[]) => void }) {
  const list = state.settings.lists[kind];
  const terms = state.terms.filter((t) => t.kind === kind && (!t.isHidden || value.includes(t.id))).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!list.on) return null;
  return (
    <fieldset className="grid gap-2" data-tags={kind}>
      <legend className="mb-1 text-sm font-medium">{list.label}</legend>
      {terms.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The list is empty. Add values in{" "}
          <Link to={`${b.home}/settings`} className="underline">
            Settings
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {terms.map((t) => {
            const on = value.includes(t.id);
            return (
              <label
                key={t.id}
                className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                <Checkbox checked={on} onCheckedChange={(v) => onChange(v ? [...value, t.id] : value.filter((x) => x !== t.id))} className={on ? "border-primary-foreground" : ""} />
                {t.name}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function Fields({ b, state, f, set, hasFile, suggested }: { b: Base | null; state: ManageState | null; f: ResourceFields; set: (f: ResourceFields) => void; hasFile: boolean; suggested: boolean }) {
  return (
    <div className="grid gap-5">
      {suggested && (
        <p className="flex items-center gap-2 text-sm text-primary">
          <Icon name="sparkle" size={15} />
          Filled from the link. Check each field.
        </p>
      )}
      <div className="flex flex-wrap gap-4">
        <Field label="Format" htmlFor="r-format" className="w-full sm:w-48">
          <NativeSelect id="r-format" value={f.format} onChange={(e) => set({ ...f, format: e.target.value as ResourceFields["format"] })}>
            {FORMATS.filter((x) => !hasFile || x === "document" || x === "video").map((x) => (
              <NativeSelectOption key={x} value={x}>
                {FORMAT_LABEL[x]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Title" htmlFor="r-title" className="min-w-64 flex-1">
          <Input id="r-title" value={f.title} maxLength={200} onChange={(e) => set({ ...f, title: e.target.value })} />
        </Field>
      </div>
      <Field label="Summary" htmlFor="r-summary" help="Two or three sentences. Cards and Ask show it.">
        <Textarea id="r-summary" rows={3} value={f.summary} maxLength={1000} onChange={(e) => set({ ...f, summary: e.target.value })} />
      </Field>
      {f.format !== "article" && (
        <Field label={f.format === "video" ? "Video link (YouTube or Vimeo)" : hasFile ? "Link (optional)" : "Link"} htmlFor="r-url">
          <Input id="r-url" type="url" value={f.sourceUrl} placeholder="https://" onChange={(e) => set({ ...f, sourceUrl: e.target.value })} />
        </Field>
      )}
      <Field
        label={f.format === "article" ? "Article" : "Notes (optional)"}
        htmlFor="r-body"
        help={f.format === "article" ? "Plain text. Leave a blank line between paragraphs." : "Readers see the notes under the summary. Ask reads them too."}
      >
        <Textarea id="r-body" rows={f.format === "article" ? 14 : 4} value={f.body} onChange={(e) => set({ ...f, body: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label="Image link (optional)" htmlFor="r-image" className="min-w-64 flex-1">
          <Input id="r-image" type="url" value={f.imageUrl} placeholder="https://" onChange={(e) => set({ ...f, imageUrl: e.target.value })} />
        </Field>
        <Field label="Site name (optional)" htmlFor="r-site" className="w-full sm:w-56">
          <Input id="r-site" value={f.siteName} onChange={(e) => set({ ...f, siteName: e.target.value })} />
        </Field>
      </div>
      {TERM_KINDS.map((k) => (
        b && state ? <TagPicker key={k} b={b} state={state} kind={k} value={f.termIds} onChange={(ids) => set({ ...f, termIds: ids })} /> : null
      ))}
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={f.featured} onCheckedChange={(v) => set({ ...f, featured: v })} />
        Feature on the library page
      </label>
    </div>
  );
}

const fieldsOf = (r: Resource): ResourceFields => ({
  format: r.format,
  title: r.title,
  summary: r.summary,
  body: r.body,
  sourceUrl: r.sourceUrl,
  imageUrl: r.imageUrl,
  siteName: r.siteName,
  featured: r.featured,
  termIds: r.termIds
});

/* Add resource */

export function AddPage({ level }: { level: Level }) {
  const { config } = useLibrary();
  const b = useBase(level);
  const { state, error: stateError } = useManage(b.allowed ? b.api : null);
  const toast = useToast();
  const [link, setLink] = useState("");
  const [f, setF] = useState<ResourceFields | null>(null);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function read() {
    if (!link.trim()) return;
    setBusy("read");
    setError(null);
    try {
      const p = await api<LinkPreview>(`${b.api}/preview`, { body: { url: link.trim() } });
      setPreview(p);
      setF({ ...EMPTY_FIELDS, format: p.format, title: p.title, summary: p.summary, sourceUrl: p.sourceUrl, imageUrl: p.imageUrl, siteName: p.siteName, termIds: p.termIds });
    } catch (e) {
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
      const r = await api<{ item: Resource }>(`${b.api}/files`, { method: "POST", form });
      toast(`Uploaded ${file.name}. Check the fields, then publish.`);
      navigate(`${b.home}/r/${r.item.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  async function save(publish: boolean) {
    if (!f) return;
    setBusy(publish ? "publish" : "save");
    setError(null);
    try {
      const r = await api<{ item: Resource }>(`${b.api}/resources`, { body: { fields: f, publish } });
      toast(publish ? `Published "${r.item.title}".` : `Saved "${r.item.title}" as a draft.`);
      reloadConfig();
      navigate(publish ? (level === "company" ? resourcePath(r.item.id) : `${b.home}?tab=published`) : `${b.home}?tab=drafts`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  if (!config) return null;
  if (!b.allowed) return <NoAccess level={level} />;
  const problem = f ? publishProblem({ ...f, hasFile: false }) : null;
  return (
    <>
      <SiteHeader title={level === "site" ? "Add to Content Vault" : "Add resource"} />
      <PageBody className="max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">{level === "site" ? "Add to Content Vault" : "Add a resource to the company library"}</h1>
        <p className="text-sm text-muted-foreground">
          {level === "site" ? "A template for every company. Company owners copy it into their own library." : "Everyone in the company can read it once you publish it."}
        </p>
        {(error || stateError) && <Notice tone="error">{error ?? stateError}</Notice>}
        <div className="grid gap-2">
          <label htmlFor="add-link" className="text-sm font-medium">
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
            <Input id="add-link" type="url" value={link} placeholder="https://" onChange={(e) => setLink(e.target.value)} className="min-w-64 flex-1 bg-background" />
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
          <p className="text-xs text-muted-foreground">
            Documents (PDF, Word, slides, sheets) and videos up to 100 MB. A YouTube or Vimeo link plays in the page.{" "}
            {!f && (
              <button type="button" className="underline" onClick={() => setF({ ...EMPTY_FIELDS, format: "article" })}>
                Or write an article.
              </button>
            )}
          </p>
        </div>
        {f && state && (
          <div className="grid gap-5 rounded-xl border p-4 sm:p-5">
            <Fields b={b} state={state} f={f} set={setF} hasFile={false} suggested={!!preview} />
            <div className="flex flex-wrap items-center gap-2">
              {!(level === "site" && state.settings.reviewOn) && (
                <Button disabled={!!busy || !!problem} onClick={() => void save(true)}>
                  {busy === "publish" ? "Publishing…" : "Publish"}
                </Button>
              )}
              <Button variant="outline" disabled={!!busy || !f.title.trim()} onClick={() => void save(false)}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </Button>
              {problem && f.title && <span className="text-xs text-muted-foreground">{problem}</span>}
              {level === "site" && state.settings.reviewOn && <span className="text-xs text-muted-foreground">Review before publish is on. Another site owner publishes this draft.</span>}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

/* Edit a resource */

export function EditPage({ id, level }: { id: string; level: Level }) {
  const { config } = useLibrary();
  const b = useBase(level);
  const { state } = useManage(b.allowed ? b.api : null);
  const toast = useToast();
  const [r, setR] = useState<Resource | null>(null);
  const [f, setF] = useState<ResourceFields | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!b.allowed) return;
    api<{ item: Resource }>(`${b.api}/resources/${id}`).then(
      (x) => {
        setR(x.item);
        setF(fieldsOf(x.item));
      },
      (e) => setError(errorText(e))
    );
  }, [b.allowed, b.api, id]);

  async function run(what: string, fn: () => Promise<{ item: Resource } | null>, done: string) {
    setBusy(what);
    setError(null);
    try {
      const x = await fn();
      if (x) {
        setR(x.item);
        setF(fieldsOf(x.item));
      }
      toast(done);
      reloadConfig();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  const saveFields = () => api<{ item: Resource }>(`${b.api}/resources/${id}`, { method: "PUT", body: f });
  const status = (action: string) => async () => {
    await saveFields();
    return api<{ item: Resource }>(`${b.api}/resources/${id}/${action}`, { method: "POST" });
  };

  if (!config) return null;
  if (!b.allowed) return <NoAccess level={level} />;
  const dirty = !!(r && f && JSON.stringify(fieldsOf(r)) !== JSON.stringify(f));
  return (
    <>
      <SiteHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Link to={`${b.home}`} className="text-muted-foreground no-underline hover:text-foreground">
              {level === "site" ? "Content Vault" : "Company resources"}
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <span className="truncate">{r?.title ?? ""}</span>
          </span>
        }
      >
        {r?.status === "published" && level === "company" && (
          <Button variant="outline" size="sm" className="ml-auto" asChild>
            <Link to={resourcePath(r.id)}>View</Link>
          </Button>
        )}
      </SiteHeader>
      <PageBody className="max-w-4xl">
        {error && <Notice tone="error">{error}</Notice>}
        {r && f && state && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={r.status === "published" ? "default" : "secondary"}>{STATUS_LABEL[r.status]}</Badge>
              <Origin r={r} />
              <span className="text-muted-foreground">Changed {ago(r.updatedAt)}</span>
              {r.hasFile && (
                <a href={fileUrl(r, null, b.api)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline">
                  <Icon name="clip" size={14} />
                  {r.fileName} · {fileSizeLabel(r.fileSize)}
                </a>
              )}
            </div>
            <ResourceMedia r={r} src={fileUrl(r, null, b.api)} manage={b.api} />
            <div className="grid gap-5 rounded-xl border p-4 sm:p-5">
              <Fields b={b} state={state} f={f} set={setF} hasFile={r.hasFile} suggested={false} />
              <div className="flex flex-wrap items-center gap-2">
                {r.status !== "published" && (
                  <Button disabled={!!busy} onClick={() => void run("publish", status("publish"), `Published "${f.title}".`)}>
                    {busy === "publish" ? "Publishing…" : "Publish"}
                  </Button>
                )}
                <Button variant={r.status === "published" ? "default" : "outline"} disabled={!!busy || !dirty} onClick={() => void run("save", saveFields, "Saved.")}>
                  {busy === "save" ? "Saving…" : r.status === "published" ? "Save changes" : "Save draft"}
                </Button>
                {r.status === "published" && (
                  <Button variant="outline" disabled={!!busy} onClick={() => void run("unpublish", status("unpublish"), "Moved back to drafts.")}>
                    Unpublish
                  </Button>
                )}
                {r.status !== "archived" ? (
                  <Button variant="ghost" disabled={!!busy} onClick={() => void run("archive", status("archive"), "Archived.")}>
                    Archive
                  </Button>
                ) : (
                  <Button variant="outline" disabled={!!busy} onClick={() => void run("restore", status("restore"), "Restored as a draft.")}>
                    Restore as draft
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive hover:text-destructive"
                  disabled={!!busy}
                  onClick={() => {
                    if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
                    void api(`${b.api}/resources/${r.id}`, { method: "DELETE" }).then(
                      () => {
                        toast("Deleted.");
                        reloadConfig();
                        navigate(`${b.home}`);
                      },
                      (e) => setError(errorText(e))
                    );
                  }}
                >
                  <Icon name="trash" />
                  Delete
                </Button>
              </div>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

/* Settings */

function ListCard({ b, state, kind, settings, setSettings, onTerms }: { b: Base; state: ManageState; kind: TermKind; settings: Settings; setSettings: (s: Settings) => void; onTerms: (t: Term[]) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = settings.lists[kind];
  const terms = state.terms.filter((t) => t.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder);
  const change = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await api<{ terms: Term[] }>(`${b.api}/terms/${id}`, { method: "PATCH", body });
      onTerms(r.terms);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="grid flex-[1_1_18rem] content-start gap-3 rounded-xl border p-4" data-list={kind}>
      <div className="flex items-end gap-3">
        <Field label="List label" htmlFor={`l-${kind}`} className="flex-1">
          <Input id={`l-${kind}`} value={list.label} maxLength={40} onChange={(e) => setSettings({ ...settings, lists: { ...settings.lists, [kind]: { ...list, label: e.target.value } } })} />
        </Field>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch checked={list.on} onCheckedChange={(v) => setSettings({ ...settings, lists: { ...settings.lists, [kind]: { ...list, on: v } } })} />
          On
        </label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {terms.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {terms.map((t, i) => (
            <li key={t.id} className="flex items-center gap-1 py-1 pl-3 pr-1">
              <span className={`flex-1 truncate ${t.isHidden ? "text-muted-foreground" : ""}`}>{t.name}</span>
              {t.isHidden && (
                <Badge variant="secondary" className="font-normal">
                  Hidden
                </Badge>
              )}
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => void change(t.id, { move: "up" })}>
                <Icon name="chevron" className="rotate-180" />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Rename ${t.name}`} onClick={() => {
                const next = prompt(`New name for "${t.name}"`, t.name);
                if (next && next.trim() !== t.name) void change(t.id, { name: next });
              }}>
                <Icon name="pencil" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void change(t.id, { isHidden: !t.isHidden })}>
                {t.isHidden ? "Show" : "Hide"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setError(null);
          try {
            const r = await api<{ term: Term }>(`${b.api}/terms`, { body: { kind, name } });
            onTerms([...state.terms, r.term]);
            setName("");
            toast(`Added ${r.term.name}.`);
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <Input aria-label={`New value for ${list.label}`} placeholder="New value" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="outline" disabled={!name.trim()}>
          <Icon name="plus" />
          Add
        </Button>
      </form>
    </section>
  );
}

function SwitchRow({ title, help, checked, onChange }: { title: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border p-4 text-sm">
      <span className="grid gap-1">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{help}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function SettingsPage({ level }: { level: Level }) {
  const { config } = useLibrary();
  const b = useBase(level);
  const { state, setState, error: loadError } = useManage(b.allowed ? b.api : null);
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (state && !s) setS(state.settings);
  }, [state, s]);
  if (!config) return null;
  if (!b.allowed) return <NoAccess level={level} />;
  const save = async () => {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<ManageState>(`${b.api}/settings`, { method: "PUT", body: s });
      setState(next);
      setS(next.settings);
      reloadConfig();
      toast("Settings saved.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const suggestions = [...(s?.suggestions ?? []), "", "", ""].slice(0, MAX_SUGGESTIONS);
  return (
    <>
      <SiteHeader title={level === "site" ? "Site Library Settings" : "Library Settings"}>
        <Button size="sm" className="ml-auto" disabled={busy || !s} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </SiteHeader>
      <PageBody className="max-w-5xl">
        {(error || loadError) && <Notice tone="error">{error ?? loadError}</Notice>}
        {state && s && (
          <>
            <div className="flex flex-wrap gap-4">
              {TERM_KINDS.map((k) => (
                <ListCard key={k} b={b} state={state} kind={k} settings={s} setSettings={setS} onTerms={(terms) => { setState({ ...state, terms }); reloadConfig(); }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              <Field label="Page title" htmlFor="s-title" className="flex-[1_1_16rem]">
                <Input id="s-title" value={s.title} maxLength={40} onChange={(e) => setS({ ...s, title: e.target.value })} />
              </Field>
              <Field label="Line under the title" htmlFor="s-intro" className="flex-[2_1_24rem]">
                <Input id="s-intro" value={s.intro} maxLength={300} onChange={(e) => setS({ ...s, intro: e.target.value })} />
              </Field>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Suggested questions on the library page</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {suggestions.map((q, i) => (
                  <Input
                    key={i}
                    aria-label={`Suggested question ${i + 1}`}
                    value={q}
                    maxLength={120}
                    placeholder="For example: What is new this month?"
                    onChange={(e) => {
                      const next = [...suggestions];
                      next[i] = e.target.value;
                      setS({ ...s, suggestions: next.map((x) => x.trim()).filter(Boolean) });
                    }}
                  />
                ))}
              </div>
            </fieldset>
            <Field label="Notice under each answer (optional)" htmlFor="s-notice">
              <Input id="s-notice" value={s.notice} maxLength={300} placeholder="For example: We give guidance, not legal advice." onChange={(e) => setS({ ...s, notice: e.target.value })} />
            </Field>
            <SwitchRow
              title="Search with AI (Ask)"
              help={
                level === "site"
                  ? "The default for every company. A company owner can turn it off in Library Settings."
                  : "Search in plain words. AI answers from the company library and each person's My Library, with links. It uses each person's own AI key, then the company key, then the site default."
              }
              checked={s.askOn}
              onChange={(v) => setS({ ...s, askOn: v })}
            />
            {level === "site" && (
              <>
            <SwitchRow
              title="Fill in new items with AI"
              help="Writes the summary and suggests the type and topics for each new Content Vault item and company resource. Uses the site's AI."
              checked={s.aiFill}
              onChange={(v) => setS({ ...s, aiFill: v })}
            />
            <SwitchRow
              title="Review before publish"
              help="In the Content Vault, a second site owner must publish each resource that a person adds. Each automation has its own setting."
              checked={s.reviewOn}
              onChange={(v) => setS({ ...s, reviewOn: v })}
            />
              </>
            )}
            {level === "site" && <p className="text-sm text-muted-foreground">The page words, lists and suggested questions here are the defaults. A new company starts with a copy of these lists, and each company owner changes them in Library Settings.</p>}
            <p className="text-sm text-muted-foreground">
              Who can read the library and use Ask is set per company, in Company settings, on the Permissions tab. Guests cannot read it unless a company owner allows it there.
            </p>
          </>
        )}
      </PageBody>
    </>
  );
}

