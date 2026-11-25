import { useEffect, useMemo, useState } from "react";
import { Icon, Link, Notice, PageBody, SiteHeader, api, errorText, navigate } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import {
  API,
  FORMATS,
  FORMAT_LABEL,
  FORMAT_PLURAL,
  HOME,
  TERM_KINDS,
  embedUrl,
  fileSizeLabel,
  type Format,
  type LibraryConfig,
  type Resource,
  type ResourceDetail,
  type Term,
  type TermKind
} from "../shared/rules";
import { FORMAT_ICON, fileUrl, fmtDate, imageUrl, resourcePath, useLibrary, visibleTerms } from "./state";
import { AskBox } from "./Ask";

/* The read pages: the library home (Ask, filters, cards) and one page for each resource. Readers see published resources only. */

type Filters = { q: string; format: Format | ""; terms: Record<TermKind, string>; sort: "newest" | "title" };

function fromUrl(): Filters {
  const p = new URLSearchParams(location.search);
  const f = p.get("format");
  return {
    q: p.get("q") ?? "",
    format: (FORMATS as string[]).includes(f ?? "") ? (f as Format) : "",
    terms: { type: p.get("type") ?? "", topic: p.get("topic") ?? "", audience: p.get("audience") ?? "" },
    sort: p.get("sort") === "title" ? "title" : "newest"
  };
}

function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.format) p.set("format", f.format);
  for (const k of TERM_KINDS) if (f.terms[k]) p.set(k, f.terms[k]);
  if (f.sort !== "newest") p.set("sort", f.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const termMap = (terms: Term[]) => new Map(terms.map((t) => [t.id, t]));

/** The format chips and one dropdown per list that is on. Filters live in the address, so a filtered view can be shared. */
function FilterBar({ config, f, setF }: { config: LibraryConfig; f: Filters; setF: (f: Filters) => void }) {
  const s = config.settings;
  const [open, setOpen] = useState(false);
  const lists = TERM_KINDS.filter((k) => s.lists[k].on && visibleTerms(config.terms, k).length > 0);
  const active = (f.format ? 1 : 0) + lists.filter((k) => f.terms[k]).length;
  return (
    <div className="grid gap-3" data-filters="">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Format">
          {(["", ...FORMATS] as const).map((fmt) => {
            const on = f.format === fmt;
            return (
              <Button
                key={fmt || "all"}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                className="rounded-full"
                onClick={() => setF({ ...f, format: fmt })}
              >
                {fmt && <Icon name={FORMAT_ICON[fmt]} />}
                {fmt ? FORMAT_PLURAL[fmt] : "All"}
              </Button>
            );
          })}
        </div>
        <span className="flex-1" />
        <Button type="button" variant="outline" size="sm" className="md:hidden" aria-expanded={open} aria-controls="library-more-filters" onClick={() => setOpen(!open)}>
          <Icon name="flag" />
          {active ? `Filters (${active})` : "Filters"}
        </Button>
      </div>
      <div id="library-more-filters" className={`${open ? "flex" : "hidden"} flex-wrap items-center gap-2 md:flex`}>
        {lists.map((k) => (
          <div key={k} className="w-[calc(50%-0.25rem)] sm:w-44">
            <NativeSelect aria-label={s.lists[k].label} value={f.terms[k]} onChange={(e) => setF({ ...f, terms: { ...f.terms, [k]: e.target.value } })} data-filter={k}>
              <NativeSelectOption value="">All: {s.lists[k].label}</NativeSelectOption>
              {visibleTerms(config.terms, k).map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {t.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ))}
        <div className="w-[calc(50%-0.25rem)] sm:w-32">
          <NativeSelect aria-label="Sort" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value === "title" ? "title" : "newest" })}>
            <NativeSelectOption value="newest">Newest</NativeSelectOption>
            <NativeSelectOption value="title">A to Z</NativeSelectOption>
          </NativeSelect>
        </div>
        <Input type="search" aria-label="Search" placeholder="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="w-full sm:w-48" />
      </div>
    </div>
  );
}

/** The picture of a card: the resource's image, or its format icon on a muted tile. */
function Thumb({ r, className = "h-32", manage = false }: { r: Resource; className?: string; manage?: boolean }) {
  const { companyId } = useLibrary();
  const [broken, setBroken] = useState(false);
  if (r.imageUrl && !broken)
    return <img src={imageUrl(r, companyId, manage)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${className} w-full rounded-lg bg-muted object-cover`} />;
  return (
    <div className={`${className} flex w-full items-center justify-center rounded-lg bg-muted text-muted-foreground`} aria-hidden="true">
      <Icon name={FORMAT_ICON[r.format]} size={28} />
    </div>
  );
}

/** Where a resource comes from, in a few words: the site, the file size, or "Written here". */
function sourceLine(r: Resource): string {
  if (r.format === "article") return "Written here";
  if (r.hasFile) return `${(r.fileName.split(".").pop() ?? "File").toUpperCase()} · ${fileSizeLabel(r.fileSize)}`;
  return r.siteName;
}

function TypeTags({ r, byId, kinds = ["type"] }: { r: Resource; byId: Map<string, Term>; kinds?: TermKind[] }) {
  const tags = r.termIds.map((id) => byId.get(id)).filter((t): t is Term => !!t && kinds.includes(t.kind));
  return (
    <>
      {tags.map((t) => (
        <Badge key={t.id} variant={t.kind === "type" ? "outline" : "secondary"} className="font-normal">
          {t.name}
        </Badge>
      ))}
    </>
  );
}

function Card({ r, byId }: { r: Resource; byId: Map<string, Term> }) {
  const topic = r.termIds.map((id) => byId.get(id)).find((t) => t?.kind === "topic");
  return (
    <article className="flex flex-col gap-2 rounded-xl border p-3" data-resource={r.id}>
      <Link to={resourcePath(r.id)} tabIndex={-1} aria-hidden="true">
        <Thumb r={r} />
      </Link>
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeTags r={r} byId={byId} />
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Icon name={FORMAT_ICON[r.format]} size={13} />
          {FORMAT_LABEL[r.format]}
        </span>
        {r.featured && (
          <Badge variant="secondary" className="font-normal">
            Featured
          </Badge>
        )}
      </div>
      <Link to={resourcePath(r.id)} className="text-[0.95rem] font-semibold leading-snug text-foreground no-underline hover:underline">
        {r.title}
      </Link>
      {r.summary && <p className="line-clamp-3 text-sm text-muted-foreground">{r.summary}</p>}
      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
        {sourceLine(r) && <span>{sourceLine(r)}</span>}
        <span>{fmtDate(r.publishedAt)}</span>
        {topic && <span>{topic.name}</span>}
      </div>
    </article>
  );
}

export function HomePage() {
  const { config, companyId, error } = useLibrary();
  const [f, setFState] = useState<Filters>(fromUrl);
  const [items, setItems] = useState<Resource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const setF = (next: Filters) => {
    setFState(next);
    history.replaceState(history.state, "", HOME + toQuery(next));
  };
  useEffect(() => {
    if (!companyId || !config) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ items: Resource[] }>(`${API}/companies/${companyId}/resources${toQuery(f)}`).then(
        (r) => live && (setItems(r.items), setLoadError(null)),
        (e) => live && setLoadError(errorText(e))
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [companyId, config, f]);
  const byId = useMemo(() => termMap(config?.terms ?? []), [config?.terms]);
  if (error) return <PageBody><Notice tone="error">{error}</Notice></PageBody>;
  if (!config) return null;
  const s = config.settings;
  const filtered = !!(f.q || f.format || Object.values(f.terms).some(Boolean));
  return (
    <>
      <SiteHeader title={s.title} />
      <PageBody className="max-w-6xl">
        <section aria-label={s.title} className="grid max-w-3xl gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{s.title}</h1>
          {s.intro && <p className="text-muted-foreground">{s.intro}</p>}
          {config.canAsk && <AskBox config={config} onAsk={(q) => navigate(`${HOME}/ask?q=${encodeURIComponent(q)}`)} />}
        </section>
        <FilterBar config={config} f={f} setF={setF} />
        {loadError && <Notice tone="error">{loadError}</Notice>}
        {items && items.length === 0 && (
          <div className="grid justify-items-start gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            <span>{filtered ? "No resource matches these filters." : "The library has no resources yet."}</span>
            {filtered && (
              <Button variant="outline" size="sm" onClick={() => setF({ q: "", format: "", terms: { type: "", topic: "", audience: "" }, sort: f.sort })}>
                Clear the filters
              </Button>
            )}
            {!filtered && config.canManage && (
              <Button size="sm" asChild>
                <Link to={`${HOME}/manage/add`}>
                  <Icon name="plus" />
                  Add resource
                </Link>
              </Button>
            )}
          </div>
        )}
        {items && items.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Resources">
            {items.map((r) => (
              <Card key={r.id} r={r} byId={byId} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

/** The player, the preview or the text of a resource. Shared with the manager's preview. */
export function ResourceMedia({ r, src, manage = false }: { r: Resource; src: string; manage?: boolean }) {
  if (r.format === "video" && (r.videoProvider === "youtube" || r.videoProvider === "vimeo")) {
    return (
      <div className="aspect-video overflow-hidden rounded-xl bg-muted">
        <iframe
          src={embedUrl(r.videoProvider, r.videoRef)}
          title={r.title}
          className="size-full"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          loading="lazy"
        />
      </div>
    );
  }
  if (r.format === "video" && r.hasFile) return <video controls preload="metadata" src={src} className="aspect-video w-full rounded-xl bg-muted" />;
  if (r.format === "document" && r.hasFile && r.fileType === "application/pdf")
    return <iframe src={src} title={r.title} className="h-[70vh] w-full rounded-xl border bg-muted" />;
  if (r.format !== "article" && r.imageUrl) return <Thumb r={r} className="max-h-80" manage={manage} />;
  return null;
}

export function ResourcePage({ id }: { id: string }) {
  const { config, companyId } = useLibrary();
  const [d, setD] = useState<ResourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    setD(null);
    api<ResourceDetail>(`${API}/companies/${companyId}/resources/${id}`).then(setD, (e) => setError(errorText(e)));
  }, [companyId, id]);
  const byId = useMemo(() => termMap(config?.terms ?? []), [config?.terms]);
  if (!config) return null;
  const r = d?.item;
  const src = r ? fileUrl(r, companyId) : "";
  return (
    <>
      <SiteHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Link to={HOME} className="text-muted-foreground no-underline hover:text-foreground">
              {config.settings.title}
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <span className="truncate">{r?.title ?? ""}</span>
          </span>
        }
      >
        {config.canManage && r && (
          <Button variant="outline" size="sm" className="ml-auto" asChild>
            <Link to={`${HOME}/manage/r/${r.id}`}>
              <Icon name="pencil" />
              Edit
            </Link>
          </Button>
        )}
      </SiteHeader>
      <PageBody className="max-w-6xl">
        {error && <Notice tone="error">{error}</Notice>}
        {r && (
          <div className="flex flex-wrap gap-8">
            <article className="grid min-w-0 flex-[999_1_32rem] content-start gap-4">
              <ResourceMedia r={r} src={src} />
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                <TypeTags r={r} byId={byId} kinds={["type", "topic", "audience"]} />
                <span className="inline-flex items-center gap-1">
                  <Icon name={FORMAT_ICON[r.format]} size={14} />
                  {[sourceLine(r), fmtDate(r.publishedAt)].filter(Boolean).join(" · ")}
                </span>
              </div>
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">{r.title}</h1>
              {r.summary && <p className="text-[0.95rem] leading-relaxed">{r.summary}</p>}
              {r.body && <div className="grid gap-3 whitespace-pre-line text-[0.95rem] leading-relaxed">{r.body}</div>}
              <div className="flex flex-wrap gap-2">
                {config.canAsk && (
                  <Button variant="outline" asChild>
                    <Link to={`${HOME}/ask?r=${encodeURIComponent(r.id)}&t=${encodeURIComponent(r.title)}`}>
                      <Icon name="sparkle" />
                      Ask about this {FORMAT_LABEL[r.format].toLowerCase()}
                    </Link>
                  </Button>
                )}
                {r.hasFile && (
                  <Button variant="outline" asChild>
                    <a href={src} target="_blank" rel="noreferrer">
                      <Icon name="download" />
                      Open the file
                    </a>
                  </Button>
                )}
                {r.sourceUrl && (
                  <Button variant="ghost" asChild>
                    <a href={r.sourceUrl} target="_blank" rel="noreferrer">
                      <Icon name="external" />
                      Open on {r.siteName || "the site"}
                    </a>
                  </Button>
                )}
              </div>
            </article>
            {d.related.length > 0 && (
              <aside className="grid flex-[1_1_16rem] content-start gap-3 lg:max-w-xs" aria-label="Related">
                <span className="text-sm font-medium text-muted-foreground">Related</span>
                {d.related.map((x) => (
                  <Link key={x.id} to={resourcePath(x.id)} className="flex items-center gap-3 rounded-lg border p-2.5 text-foreground no-underline hover:bg-accent">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon name={FORMAT_ICON[x.format]} size={16} />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="line-clamp-2 text-sm font-medium">{x.title}</span>
                      <span className="text-xs text-muted-foreground">{FORMAT_LABEL[x.format]}</span>
                    </span>
                  </Link>
                ))}
              </aside>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}
