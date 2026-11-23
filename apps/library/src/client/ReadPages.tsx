import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, Link, Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import {
  API,
  HOME,
  TERM_KINDS,
  siteOf,
  type LibraryConfig,
  type PublishedSource,
  type PublishedUpdate,
  type SourceDetail,
  type Term,
  type TermKind,
  type UpdateDetail
} from "../shared/rules";
import { fmtDate, useLibrary, visibleTerms } from "./state";

/* The read pages: the sources, the updates, and one page for each. Readers see published copies only. */

type Picked = Record<TermKind, string[]>;
const NONE: Picked = { category: [], audience: [], topic: [] };

function query(q: string, picked: Picked): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q.trim());
  for (const k of TERM_KINDS) if (picked[k].length) p.set(k, picked[k].join(","));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The tags of an item, from the lists that are on. Hidden list items still show on the items that have them. */
function Tags({ termIds, config, children }: { termIds: string[]; config: LibraryConfig; children?: ReactNode }) {
  const byId = useMemo(() => new Map(config.terms.map((t) => [t.id, t])), [config.terms]);
  const terms = termIds.map((id) => byId.get(id)).filter((t): t is Term => !!t);
  terms.sort((a, b) => TERM_KINDS.indexOf(a.kind) - TERM_KINDS.indexOf(b.kind) || a.sortOrder - b.sortOrder);
  if (!terms.length && !children) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {children}
      {terms.map((t) => (
        <Badge key={t.id} variant={t.kind === "category" ? "outline" : "secondary"} className={t.kind === "category" ? "font-semibold" : "font-normal"}>
          {t.name}
        </Badge>
      ))}
    </div>
  );
}

/** The title and the notice under it. */
function Intro({ config, sub }: { config: LibraryConfig; sub?: string }) {
  return (
    <div className="grid gap-1">
      <h2 className="text-2xl font-semibold tracking-tight">{sub ?? config.settings.title}</h2>
      {config.settings.notice && <p className="max-w-3xl text-sm text-muted-foreground">{config.settings.notice}</p>}
    </div>
  );
}

/** Search and one group of boxes per list that is on. */
function Filters({ config, q, setQ, picked, setPicked, placeholder }: {
  config: LibraryConfig;
  q: string;
  setQ: (v: string) => void;
  picked: Picked;
  setPicked: (p: Picked) => void;
  placeholder: string;
}) {
  const s = config.settings;
  const [open, setOpen] = useState(false);
  const count = Object.values(picked).reduce((n, v) => n + v.length, 0);
  return (
    <aside aria-label="Filters" className="grid content-start gap-5 md:w-56 md:shrink-0">
      <div className="grid gap-2">
        <label htmlFor="library-q" className="text-sm font-medium">
          Search
        </label>
        <Input id="library-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      </div>
      {TERM_KINDS.some((k) => s.lists[k].on && visibleTerms(config.terms, k).length) && (
        <Button type="button" variant="outline" className="w-fit md:hidden" aria-expanded={open} aria-controls="library-filters" onClick={() => setOpen(!open)}>
          <Icon name="flag" />
          {open ? "Hide filters" : count ? `Filters (${count})` : "Filters"}
        </Button>
      )}
      <div id="library-filters" className={`${open ? "grid" : "hidden"} gap-5 md:grid`}>
        {TERM_KINDS.filter((k) => s.lists[k].on).map((k) => {
          const terms = visibleTerms(config.terms, k);
          if (!terms.length) return null;
          return (
            <fieldset key={k} className="grid gap-2" data-filter={k}>
              <legend className="mb-1 text-sm font-medium">{s.lists[k].label}</legend>
              {terms.map((t) => {
                const on = picked[k].includes(t.id);
                return (
                  <label key={t.id} className="flex min-h-7 items-center gap-2 text-sm">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) => setPicked({ ...picked, [k]: v ? [...picked[k], t.id] : picked[k].filter((x) => x !== t.id) })}
                    />
                    {t.name}
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </div>
    </aside>
  );
}

/** Loads a list with filters, and loads again 250 ms after the last change. */
function useList<T>(path: string, companyId: string | null, q: string, picked: Picked) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ items: T[] }>(`${API}/companies/${companyId}/${path}${query(q, picked)}`).then(
        (r) => live && (setItems(r.items), setError(null)),
        (e) => live && setError(errorText(e))
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [path, companyId, q, picked]);
  return { items, error };
}

function Loading({ title }: { title: string }) {
  const { error } = useLibrary();
  return (
    <>
      <SiteHeader title={title} />
      <PageBody>{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Loading…</p>}</PageBody>
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{children}</div>;
}

function SourceCard({ s, config }: { s: PublishedSource; config: LibraryConfig }) {
  return (
    <article className="grid gap-2 rounded-lg border p-4" data-library-source={s.id}>
      <Tags termIds={s.termIds} config={config}>
        {s.updatedDate && <Badge className="font-semibold">Updated {fmtDate(s.updatedDate).replace(/, \d{4}$/, "")}</Badge>}
      </Tags>
      <Link to={`${HOME}/sources/${s.id}`} className="text-base font-semibold hover:underline">
        {s.title}
      </Link>
      {s.summary && <p className="text-sm text-muted-foreground">{s.summary}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {s.sourceUrl && (
          <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
            {siteOf(s.sourceUrl)}
            <Icon name="external" size={13} />
          </a>
        )}
        {config.settings.showLastChecked && s.lastCheckedDate && <span>Last checked {fmtDate(s.lastCheckedDate)}</span>}
      </div>
    </article>
  );
}

export function SourcesPage() {
  const { config, companyId } = useLibrary();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Picked>(NONE);
  const { items, error } = useList<PublishedSource>("sources", companyId, q, picked);
  if (!config) return <Loading title="Library" />;
  const s = config.settings;
  return (
    <>
      <SiteHeader title={s.sourcesName} />
      <PageBody>
        <Intro config={config} />
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <Filters config={config} q={q} setQ={setQ} picked={picked} setPicked={setPicked} placeholder={`Search ${s.sourcesName.toLowerCase()}`} />
          <section aria-label={s.sourcesName} className="grid min-w-0 flex-1 gap-3">
            {error && <Notice tone="error">{error}</Notice>}
            {items && (
              <p className="text-sm text-muted-foreground" data-library-count="">
                {items.length === 1 ? "1 item" : `${items.length} items`}
              </p>
            )}
            {items?.map((it) => <SourceCard key={it.id} s={it} config={config} />)}
            {items && !items.length && (
              <Empty>{q || Object.values(picked).some((v) => v.length) ? "Nothing matches. Change the search or the filters." : "Nothing is published yet."}</Empty>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}

function UpdateFieldsView({ u, config, full = false }: { u: PublishedUpdate; config: LibraryConfig; full?: boolean }) {
  const l = config.settings.fieldLabels;
  const rows: [string, ReactNode][] = [];
  if (u.whatChanged) rows.push([l.whatChanged, u.whatChanged]);
  if (u.whoAffected) rows.push([l.whoAffected, u.whoAffected]);
  if (u.action || u.actionDueDate)
    rows.push([
      l.action,
      <>
        {u.action}
        {u.actionDueDate && (
          <>
            {u.action ? " " : ""}
            <strong className="font-semibold">
              {l.dueDate}: {fmtDate(u.actionDueDate)}
            </strong>
          </>
        )}
      </>
    ]);
  if (full)
    return (
      <div className="grid gap-5">
        {rows.map(([k, v]) => (
          <section key={k} className="grid gap-1.5">
            <h3 className="text-base font-semibold">{k}</h3>
            <p className="whitespace-pre-line text-[0.95rem] leading-relaxed">{v}</p>
          </section>
        ))}
      </div>
    );
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(7rem,max-content)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-muted-foreground">{k}</dt>
          <dd className="line-clamp-3">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function UpdateCard({ u, config }: { u: PublishedUpdate; config: LibraryConfig }) {
  return (
    <article className={`grid gap-3 rounded-lg border p-4 ${u.isNew ? "border-primary/30" : ""}`} data-library-update={u.id}>
      <Tags termIds={u.termIds} config={config}>
        {u.isNew && <Badge className="font-semibold">New</Badge>}
        {u.publishedDate && <span className="text-sm text-muted-foreground">{fmtDate(u.publishedDate)}</span>}
      </Tags>
      <Link to={`${HOME}/updates/${u.id}`} className="text-base font-semibold hover:underline">
        {u.title}
      </Link>
      <UpdateFieldsView u={u} config={config} />
      {u.sourceUrl && (
        <a href={u.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm underline-offset-4 hover:underline">
          {siteOf(u.sourceUrl)}
          <Icon name="external" size={13} />
        </a>
      )}
    </article>
  );
}

export function UpdatesPage() {
  const { config, companyId } = useLibrary();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Picked>(NONE);
  const { items, error } = useList<PublishedUpdate>("updates", companyId, q, picked);
  if (!config) return <Loading title="Updates" />;
  const s = config.settings;
  const fresh = items?.filter((u) => u.isNew) ?? [];
  const older = items?.filter((u) => !u.isNew) ?? [];
  return (
    <>
      <SiteHeader title={s.updatesName} />
      <PageBody>
        <Intro config={config} sub={s.updatesName} />
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <Filters config={config} q={q} setQ={setQ} picked={picked} setPicked={setPicked} placeholder={`Search ${s.updatesName.toLowerCase()}`} />
          <section aria-label={s.updatesName} className="grid min-w-0 flex-1 gap-3">
            {error && <Notice tone="error">{error}</Notice>}
            {fresh.length > 0 && <h3 className="text-sm font-medium text-muted-foreground">New in the last {s.newDays} days</h3>}
            {fresh.map((u) => <UpdateCard key={u.id} u={u} config={config} />)}
            {older.length > 0 && fresh.length > 0 && <h3 className="mt-2 text-sm font-medium text-muted-foreground">Earlier</h3>}
            {older.map((u) => <UpdateCard key={u.id} u={u} config={config} />)}
            {items && !items.length && (
              <Empty>{q || Object.values(picked).some((v) => v.length) ? "Nothing matches. Change the search or the filters." : "Nothing is published yet."}</Empty>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}

function useDetail<T>(path: string) {
  const { config, companyId } = useLibrary();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    setData(null);
    api<T>(`${API}/companies/${companyId}/${path}`).then(setData, (e) => setError(errorText(e)));
  }, [companyId, path]);
  return { config, data, error };
}

function DetailShell({ back, backLabel, title, config, error, children, aside }: {
  back: string;
  backLabel: string;
  title: string;
  config: LibraryConfig | null;
  error: string | null;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <>
      <SiteHeader
        title={
          <span className="flex items-center gap-2">
            <Link to={back} className="text-muted-foreground hover:text-foreground">
              {backLabel}
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <span className="truncate">{title}</span>
          </span>
        }
      />
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        {!error && !children && <p className="text-sm text-muted-foreground">Loading…</p>}
        {children && config && (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <article className="grid min-w-0 max-w-3xl flex-1 gap-6">{children}</article>
            <aside className="grid gap-4 lg:w-72 lg:shrink-0">{aside}</aside>
          </div>
        )}
        {config?.settings.notice && children && <p className="max-w-3xl text-xs text-muted-foreground">{config.settings.notice}</p>}
      </PageBody>
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 rounded-lg border p-4 text-sm">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function OfficialLink({ url }: { url: string }) {
  return (
    <Button asChild variant="outline" className="w-fit">
      <a href={url} target="_blank" rel="noreferrer">
        <Icon name="external" />
        Open the source ({siteOf(url)})
      </a>
    </Button>
  );
}

export function SourcePage({ id }: { id: string }) {
  const { config, data, error } = useDetail<SourceDetail>(`sources/${encodeURIComponent(id)}`);
  const s = data?.item;
  return (
    <DetailShell
      back={HOME}
      backLabel={config?.settings.sourcesName ?? "Sources"}
      title={s?.title ?? ""}
      config={config}
      error={error}
      aside={
        s &&
        config && (
          <>
            {data!.updates.length > 0 && (
              <Panel title={config.settings.updatesName}>
                {data!.updates.map((u) => (
                  <Link key={u.id} to={`${HOME}/updates/${u.id}`} className="underline-offset-4 hover:underline">
                    {u.title}
                    {u.publishedDate && <span className="text-muted-foreground"> · {fmtDate(u.publishedDate)}</span>}
                  </Link>
                ))}
              </Panel>
            )}
            <Panel title="About this item">
              <span className="text-muted-foreground">Version {s.version}</span>
              {config.settings.showLastChecked && s.lastCheckedDate && <span className="text-muted-foreground">Last checked {fmtDate(s.lastCheckedDate)}</span>}
            </Panel>
          </>
        )
      }
    >
      {s && config && (
        <>
          <div className="grid gap-3">
            <Tags termIds={s.termIds} config={config}>
              {s.updatedDate && <Badge className="font-semibold">Updated</Badge>}
            </Tags>
            <h2 className="text-2xl font-semibold leading-tight tracking-tight">{s.title}</h2>
            {s.citation && <p className="text-sm text-muted-foreground">{s.citation}</p>}
          </div>
          {s.summary && <p className="text-base font-medium">{s.summary}</p>}
          {s.details && <p className="whitespace-pre-line leading-relaxed">{s.details}</p>}
          {s.sourceUrl && <OfficialLink url={s.sourceUrl} />}
        </>
      )}
    </DetailShell>
  );
}

export function UpdatePage({ id }: { id: string }) {
  const { config, data, error } = useDetail<UpdateDetail>(`updates/${encodeURIComponent(id)}`);
  const u = data?.item;
  return (
    <DetailShell
      back={`${HOME}/updates`}
      backLabel={config?.settings.updatesName ?? "Updates"}
      title={u?.title ?? ""}
      config={config}
      error={error}
      aside={
        u &&
        config && (
          <>
            {data!.sources.length > 0 && (
              <Panel title={`${config.settings.sourcesName} it changes`}>
                {data!.sources.map((s) => (
                  <Link key={s.id} to={`${HOME}/sources/${s.id}`} className="underline-offset-4 hover:underline">
                    {s.title}
                  </Link>
                ))}
              </Panel>
            )}
            <Panel title="About this item">
              <span className="text-muted-foreground">Version {u.version}</span>
            </Panel>
          </>
        )
      }
    >
      {u && config && (
        <>
          <div className="grid gap-3">
            <Tags termIds={u.termIds} config={config}>
              {u.isNew && <Badge className="font-semibold">New</Badge>}
            </Tags>
            <h2 className="text-2xl font-semibold leading-tight tracking-tight">{u.title}</h2>
            {u.publishedDate && <p className="text-sm text-muted-foreground">Published {fmtDate(u.publishedDate)}</p>}
          </div>
          <UpdateFieldsView u={u} config={config} full />
          {u.sourceUrl && <OfficialLink url={u.sourceUrl} />}
        </>
      )}
    </DetailShell>
  );
}
