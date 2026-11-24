import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  EMPTY_SOURCE,
  EMPTY_UPDATE,
  HOME,
  KIND_PATH,
  MAX_CHECKS,
  STATUS_LABEL,
  TERM_KINDS,
  kindFromPath,
  type ItemKind,
  type ManageItem,
  type ManageRow,
  type ReviewAction,
  type Settings,
  type SourceFields,
  type Status,
  type Term,
  type TermKind,
  type UpdateFields
} from "../shared/rules";
import { fmtDate, localToday, reloadConfig, useLibrary, useManage } from "./state";

/* The super admin pages. The server checks requireSuperAdmin on every call. The panel shows these pages to super admins only. */

const STATUS_STYLE: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  in_review: "border-warn-border bg-warn text-warn-foreground",
  published: "bg-primary text-primary-foreground",
  archived: "bg-muted text-muted-foreground"
};

function StatusBadge({ status, live }: { status: Status; live: number | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={STATUS_STYLE[status]}>
        {STATUS_LABEL[status]}
      </Badge>
      {status !== "published" && status !== "archived" && live !== null && <span className="hidden text-xs text-muted-foreground sm:inline">Readers see version {live}</span>}
    </span>
  );
}

function NotAllowed({ title }: { title: string }) {
  return (
    <>
      <SiteHeader title={title} />
      <PageBody>
        <Notice tone="info">Only super admins can manage the library.</Notice>
      </PageBody>
    </>
  );
}

const FILTERS: (Status | "all")[] = ["all", "draft", "in_review", "published", "archived"];

export function ManagePage() {
  const { config } = useLibrary();
  const { state, error } = useManage(!!config?.canManage);
  const [filter, setFilter] = useState<Status | "all">("all");
  if (config && !config.canManage) return <NotAllowed title="Manage" />;
  const s = state?.settings;
  const rows = state?.rows ?? [];
  const count = (f: Status | "all") => (f === "all" ? rows.length : rows.filter((r) => r.status === f).length);
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const kindName = (k: ItemKind) => (k === "source" ? s?.sourcesName : s?.updatesName) ?? k;
  return (
    <>
      <SiteHeader title="Manage">
        <Button variant="outline" size="sm" asChild>
          <Link to={`${HOME}/manage/sources/new`}>
            <Icon name="plus" />
            <span className="hidden sm:inline">Add to {s?.sourcesName ?? "Sources"}</span>
            <span className="sm:hidden">Source</span>
          </Link>
        </Button>
        <Button size="sm" asChild>
          <Link to={`${HOME}/manage/updates/new`}>
            <Icon name="plus" />
            <span className="hidden sm:inline">Add to {s?.updatesName ?? "Updates"}</span>
            <span className="sm:hidden">Update</span>
          </Link>
        </Button>
      </SiteHeader>
      <PageBody>
        <div className="grid gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Manage the library</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Only super admins see this page. Readers see an item only after it is published. An edit to a published item stays a draft until you publish it again.
          </p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div role="tablist" aria-label="Status" className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-9 rounded-md px-3 text-sm ${filter === f ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f === "all" ? "All" : STATUS_LABEL[f]} {state ? count(f) : ""}
            </button>
          ))}
        </div>
        {!state && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm md:min-w-[44rem]" data-library-manage="">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Kind</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Last change</th>
                  <th className="px-4 py-2.5 font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r: ManageRow) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground md:hidden">{kindName(r.kind)}</div>
                      {r.reviewNote && <div className="text-xs text-muted-foreground">Note: {r.reviewNote}</div>}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">{kindName(r.kind)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} live={r.liveVersion} />
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {fmtDate(r.updatedAt)}
                      {r.updatedByName ? ` · ${r.updatedByName}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`${HOME}/manage/${KIND_PATH[r.kind]}/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.status === "in_review" ? "Review" : "Edit"}
                      </Link>
                    </td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      {rows.length ? "No items with this status." : "No items yet. Add a source or an update to start."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}

/** One group of boxes per list, for the editor. Hidden items show only when the item already has them. */
function TermPicker({ kind, settings, terms, value, onChange, single }: {
  kind: TermKind;
  settings: Settings;
  terms: Term[];
  value: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
}) {
  const list = terms.filter((t) => t.kind === kind && (!t.isHidden || value.includes(t.id))).sort((a, b) => a.sortOrder - b.sortOrder);
  const l = settings.lists[kind];
  return (
    <fieldset className="grid content-start gap-2" data-pick={kind}>
      <legend className="mb-1 text-sm font-medium">
        {l.label}
        {!l.on && <span className="font-normal text-muted-foreground"> (list off)</span>}
      </legend>
      {!list.length && (
        <p className="text-xs text-muted-foreground">
          No items yet. Add them in{" "}
          <Link to={`${HOME}/manage/settings`} className="underline">
            Lists and settings
          </Link>
          .
        </p>
      )}
      {list.map((t) => {
        const on = value.includes(t.id);
        return (
          <label key={t.id} className="flex min-h-7 items-center gap-2 text-sm">
            <Checkbox
              checked={on}
              onCheckedChange={(v) => {
                const rest = value.filter((x) => x !== t.id && (!single || terms.find((y) => y.id === x)?.kind !== kind));
                onChange(v ? [...rest, t.id] : value.filter((x) => x !== t.id));
              }}
            />
            {t.name}
            {t.isHidden && <span className="text-xs text-muted-foreground">(hidden)</span>}
          </label>
        );
      })}
    </fieldset>
  );
}

type AnyFields = SourceFields | UpdateFields;

export function EditorPage({ kindPath, id }: { kindPath: string; id: string }) {
  const kind = kindFromPath(kindPath);
  const { config } = useLibrary();
  const { state } = useManage(!!config?.canManage);
  const toast = useToast();
  const isNew = id === "new";
  const [item, setItem] = useState<ManageItem | null>(null);
  const [fields, setFields] = useState<AnyFields | null>(isNew ? (kind === "source" ? { ...EMPTY_SOURCE } : { ...EMPTY_UPDATE }) : null);
  const [dirty, setDirty] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([]);
  const [note, setNote] = useState("");
  const [pubDate, setPubDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!kind || isNew) return;
    api<ManageItem>(`${API}/manage/items/${kindPath}/${id}`).then(
      (it) => {
        setItem(it);
        setFields(it.fields);
        setDirty(false);
      },
      (e) => setProblem(errorText(e))
    );
  }, [kind, kindPath, id, isNew]);

  useEffect(() => setChecks((state?.settings.checklist ?? []).map(() => false)), [state?.settings.checklist, item?.id, item?.status]);

  if (!kind) return <NotAllowed title="Manage" />;
  if (config && !config.canManage) return <NotAllowed title="Manage" />;
  const s = state?.settings;
  const kindName = kind === "source" ? (s?.sourcesName ?? "Sources") : (s?.updatesName ?? "Updates");
  const set = (patch: Partial<AnyFields>) => {
    setFields((f) => ({ ...(f as AnyFields), ...patch }) as AnyFields);
    setDirty(true);
  };

  async function save(): Promise<ManageItem | null> {
    if (!fields) return null;
    setBusy(true);
    setProblem(null);
    try {
      if (isNew) {
        const it = await api<ManageItem>(`${API}/manage/items/${kindPath}`, { method: "POST", body: fields });
        setDirty(false);
        navigate(`${HOME}/manage/${kindPath}/${it.id}`, true);
        return it;
      }
      const it = await api<ManageItem>(`${API}/manage/items/${kindPath}/${id}`, { method: "PUT", body: fields });
      setItem(it);
      setFields(it.fields);
      setDirty(false);
      return it;
    } catch (e) {
      setProblem(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function act(action: ReviewAction) {
    if (dirty && !(await save())) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = action === "publish" ? { checks, publishedDate: kind === "update" ? pubDate || (fields as UpdateFields | null)?.publishedDate || localToday() : null } : action === "return" ? { note } : undefined;
      const it = await api<ManageItem>(`${API}/manage/items/${kindPath}/${id}/${action}`, { method: "POST", body });
      setItem(it);
      setFields(it.fields);
      setNote("");
      if (action === "publish") {
        toast(`Published version ${it.liveVersion}.`);
        reloadConfig();
      }
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <SiteHeader
      title={
        <span className="flex items-center gap-2">
          <Link to={`${HOME}/manage`} className="text-muted-foreground hover:text-foreground">
            Manage
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="truncate">{isNew ? `Add to ${kindName}` : (item?.fields.title ?? "Edit")}</span>
        </span>
      }
    >
      {item && <StatusBadge status={item.status} live={item.liveVersion} />}
      <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy || !fields || (!dirty && !isNew) || item?.status === "archived"}>
        Save draft
      </Button>
    </SiteHeader>
  );

  if (!fields || !s || !state)
    return (
      <>
        {header}
        <PageBody>{problem ? <Notice tone="error">{problem}</Notice> : <p className="text-sm text-muted-foreground">Loading…</p>}</PageBody>
      </>
    );

  const src = kind === "source" ? (fields as SourceFields) : null;
  const upd = kind === "update" ? (fields as UpdateFields) : null;
  const allSources = state.rows.filter((r) => r.kind === "source" && r.status !== "archived");
  const linked = upd ? upd.sourceIds.map((sid) => allSources.find((r) => r.id === sid)).filter((r): r is ManageRow => !!r) : [];
  const archived = item?.status === "archived";
  const allTicked = checks.length === s.checklist.length && checks.every(Boolean);

  return (
    <>
      {header}
      <PageBody>
        {problem && <Notice tone="error">{problem}</Notice>}
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <form className="grid min-w-0 max-w-3xl flex-1 gap-5" onSubmit={(e) => (e.preventDefault(), void save())} data-library-editor={kind}>
            {item && item.liveVersion !== null && item.status !== "published" && !archived && (
              <Notice tone="info">This is a new draft of a published item. Readers see version {item.liveVersion} until you publish.</Notice>
            )}
            {item?.reviewNote && <Notice tone="warn">Review note: {item.reviewNote}</Notice>}
            <fieldset disabled={archived} className="grid gap-5">
              <Field label="Title" htmlFor="lib-title">
                <Input id="lib-title" value={fields.title} onChange={(e) => set({ title: e.target.value })} required maxLength={200} />
              </Field>
              {src && (
                <>
                  <Field label="Citation" htmlFor="lib-cite" help="For example, 42 CFR Part 483, Subpart I.">
                    <Input id="lib-cite" value={src.citation} onChange={(e) => set({ citation: e.target.value })} maxLength={300} />
                  </Field>
                  <Field label="Summary (one line)" htmlFor="lib-sum">
                    <Input id="lib-sum" value={src.summary} onChange={(e) => set({ summary: e.target.value })} maxLength={300} />
                  </Field>
                  <Field label="Details" htmlFor="lib-det">
                    <Textarea id="lib-det" rows={5} value={src.details} onChange={(e) => set({ details: e.target.value })} maxLength={4000} />
                  </Field>
                </>
              )}
              {upd && (
                <>
                  <Field label={s.fieldLabels.whatChanged} htmlFor="lib-what">
                    <Textarea id="lib-what" rows={3} value={upd.whatChanged} onChange={(e) => set({ whatChanged: e.target.value })} maxLength={4000} />
                  </Field>
                  <Field label={s.fieldLabels.whoAffected} htmlFor="lib-who">
                    <Textarea id="lib-who" rows={2} value={upd.whoAffected} onChange={(e) => set({ whoAffected: e.target.value })} maxLength={4000} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
                    <Field label={s.fieldLabels.action} htmlFor="lib-do">
                      <Textarea id="lib-do" rows={3} value={upd.action} onChange={(e) => set({ action: e.target.value })} maxLength={4000} />
                    </Field>
                    <Field label={`${s.fieldLabels.dueDate} (optional)`} htmlFor="lib-due" help="Leave it empty when the source sets no date.">
                      <Input id="lib-due" type="date" value={upd.actionDueDate ?? ""} onChange={(e) => set({ actionDueDate: e.target.value || null })} />
                    </Field>
                  </div>
                </>
              )}
              <div className={`grid gap-4 ${src && s.showLastChecked ? "sm:grid-cols-[1fr_12rem]" : ""}`}>
                <Field label="Official source link" htmlFor="lib-url" help="https only.">
                  <Input id="lib-url" type="url" value={fields.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://" maxLength={600} />
                </Field>
                {src && s.showLastChecked && (
                  <Field label="Last checked" htmlFor="lib-checked">
                    <Input id="lib-checked" type="date" value={src.lastCheckedDate ?? ""} onChange={(e) => set({ lastCheckedDate: e.target.value || null })} />
                  </Field>
                )}
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                {TERM_KINDS.map((k) => (
                  <TermPicker
                    key={k}
                    kind={k}
                    settings={s}
                    terms={state.terms}
                    value={fields.termIds}
                    onChange={(termIds) => set({ termIds })}
                    single={kind === "source" && k === "category"}
                  />
                ))}
              </div>
              {upd && (
                <div className="grid gap-2">
                  <label htmlFor="lib-link" className="text-sm font-medium">
                    {s.sourcesName} it changes
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {linked.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-1 text-sm">
                        {r.title}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-full"
                          aria-label={`Remove ${r.title}`}
                          onClick={() => set({ sourceIds: upd.sourceIds.filter((x) => x !== r.id) })}
                        >
                          <Icon name="x" size={13} />
                        </Button>
                      </span>
                    ))}
                    <NativeSelect
                      id="lib-link"
                      value=""
                      onChange={(e) => e.target.value && set({ sourceIds: [...upd.sourceIds, e.target.value] })}
                      className="w-64"
                    >
                      <NativeSelectOption value="">Add a source…</NativeSelectOption>
                      {allSources
                        .filter((r) => !upd.sourceIds.includes(r.id))
                        .map((r) => (
                          <NativeSelectOption key={r.id} value={r.id}>
                            {r.title}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </div>
                  <p className="text-xs text-muted-foreground">Each linked source shows "Updated" for {s.newDays} days after this update is published.</p>
                </div>
              )}
            </fieldset>
            {isNew && (
              <div>
                <Button type="submit" disabled={busy || !fields.title.trim()}>
                  Save draft
                </Button>
              </div>
            )}
          </form>

          {item && (
            <aside className="grid gap-4 lg:w-80 lg:shrink-0">
              <ReviewPanel
                item={item}
                settings={s}
                checks={checks}
                setChecks={setChecks}
                allTicked={allTicked}
                note={note}
                setNote={setNote}
                pubDate={pubDate}
                setPubDate={setPubDate}
                busy={busy}
                dirty={dirty}
                act={act}
              />
              <section className="grid gap-1.5 rounded-lg border p-4 text-sm" data-library-history="">
                <h3 className="font-semibold">History</h3>
                {item.updatedByName && (
                  <span className="text-muted-foreground">
                    Last change {fmtDate(item.updatedAt)} · {item.updatedByName}
                  </span>
                )}
                {item.history.map((h) => (
                  <span key={h.version} className="text-muted-foreground">
                    Version {h.version} published {fmtDate(h.publishedAt)}
                    {h.publishedByName ? ` · ${h.publishedByName}` : ""}
                  </span>
                ))}
                {!item.history.length && <span className="text-muted-foreground">Never published.</span>}
              </section>
            </aside>
          )}
        </div>
      </PageBody>
    </>
  );
}

function ReviewPanel(p: {
  item: ManageItem;
  settings: Settings;
  checks: boolean[];
  setChecks: (c: boolean[]) => void;
  allTicked: boolean;
  note: string;
  setNote: (v: string) => void;
  pubDate: string;
  setPubDate: (v: string) => void;
  busy: boolean;
  dirty: boolean;
  act: (a: ReviewAction) => void;
}) {
  const { item, settings: s } = p;
  if (item.status === "archived")
    return (
      <section className="grid gap-3 rounded-lg border p-4">
        <h3 className="text-base font-semibold">Archived</h3>
        <p className="text-sm text-muted-foreground">Readers do not see this item. Its versions stay.</p>
        <Button variant="outline" onClick={() => p.act("restore")} disabled={p.busy}>
          Restore
        </Button>
      </section>
    );
  const nothingNew = item.status === "published" && !p.dirty;
  return (
    <section className="grid gap-3 rounded-lg border border-warn-border bg-warn/40 p-4" data-library-review="">
      <h3 className="text-base font-semibold">Review and publish</h3>
      {item.status === "in_review" && item.submittedByName && <p className="text-sm text-muted-foreground">Sent for review by {item.submittedByName}.</p>}
      {nothingNew ? (
        <p className="text-sm text-muted-foreground">Readers see this version. Edit the item to make a new draft.</p>
      ) : (
        <>
          {s.checklist.length > 0 && (
            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1 text-sm font-medium">Check before you publish</legend>
              {s.checklist.map((c, i) => (
                <label key={i} className="flex items-start gap-2">
                  <Checkbox className="mt-0.5" checked={!!p.checks[i]} onCheckedChange={(v) => p.setChecks(p.checks.map((x, j) => (j === i ? !!v : x)))} />
                  {c}
                </label>
              ))}
            </fieldset>
          )}
          {item.kind === "update" && (
            <Field label="Published date" htmlFor="lib-pub" help="Empty: today, or the date already set.">
              <Input id="lib-pub" type="date" value={p.pubDate || ((item.fields as UpdateFields).publishedDate ?? "")} onChange={(e) => p.setPubDate(e.target.value)} />
            </Field>
          )}
          {item.publishBlock && !p.dirty && <p className="text-sm text-muted-foreground">{item.publishBlock}</p>}
          <div className="flex flex-wrap gap-2">
            {item.status === "draft" && (
              <Button variant="outline" onClick={() => p.act("submit")} disabled={p.busy}>
                Send for review
              </Button>
            )}
            <Button onClick={() => p.act("publish")} disabled={p.busy || !p.allTicked || (!item.canPublish && !p.dirty)}>
              Publish version {(item.liveVersion ?? 0) + 1}
            </Button>
          </div>
          {item.status === "in_review" && (
            <div className="grid gap-2">
              <label htmlFor="lib-note" className="text-sm font-medium">
                Note to the writer
              </label>
              <Textarea id="lib-note" rows={2} value={p.note} onChange={(e) => p.setNote(e.target.value)} placeholder="What to fix" maxLength={300} />
              <Button variant="outline" onClick={() => p.act("return")} disabled={p.busy || !p.note.trim()}>
                Send back to draft
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {s.requireSecondReviewer
              ? "This site needs a second reviewer: a different super admin must publish."
              : "Publish turns on when every check is ticked."}
          </p>
        </>
      )}
      <Button variant="ghost" className="w-fit" onClick={() => p.act("archive")} disabled={p.busy}>
        <Icon name="archive" />
        Archive
      </Button>
    </section>
  );
}

/* Lists and settings */

function ListCard({ kind, settings, setSettings, terms, onChanged }: {
  kind: TermKind;
  settings: Settings;
  setSettings: (s: Settings) => void;
  terms: Term[];
  onChanged: (terms: Term[]) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const list = terms.filter((t) => t.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder);
  const l = settings.lists[kind];

  async function patch(id: string, body: Record<string, unknown>) {
    setProblem(null);
    try {
      const r = await api<{ terms: Term[] }>(`${API}/manage/terms/${id}`, { method: "PATCH", body });
      onChanged(r.terms);
    } catch (e) {
      setProblem(errorText(e));
    }
  }
  async function add() {
    if (!name.trim()) return;
    setProblem(null);
    try {
      const r = await api<{ term: Term }>(`${API}/manage/terms`, { method: "POST", body: { kind, name } });
      onChanged([...terms, r.term]);
      setName("");
      toast(`Added ${r.term.name}.`);
    } catch (e) {
      setProblem(errorText(e));
    }
  }

  return (
    <section className="grid content-start gap-3 rounded-lg border p-4" data-library-list={kind}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">List: {kind}</span>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={l.on} onCheckedChange={(on) => setSettings({ ...settings, lists: { ...settings.lists, [kind]: { ...l, on } } })} />
          On
        </label>
      </div>
      <Field label="Label readers see" htmlFor={`lib-label-${kind}`}>
        <Input
          id={`lib-label-${kind}`}
          value={l.label}
          maxLength={40}
          onChange={(e) => setSettings({ ...settings, lists: { ...settings.lists, [kind]: { ...l, label: e.target.value } } })}
        />
      </Field>
      {problem && <Notice tone="error">{problem}</Notice>}
      <ul className="divide-y rounded-md border text-sm">
        {list.map((t, i) => (
          <li key={t.id} className="flex items-center gap-1 py-1 pl-1 pr-1">
            <Input
              aria-label={`Name of ${t.name}`}
              defaultValue={t.name}
              maxLength={60}
              className={`h-8 border-transparent shadow-none ${t.isHidden ? "text-muted-foreground" : ""}`}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && void patch(t.id, { name: e.target.value })}
            />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => void patch(t.id, { move: "up" })}>
              <Icon name="chevron" className="rotate-180" size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Move ${t.name} down`}
              disabled={i === list.length - 1}
              onClick={() => void patch(t.id, { move: "down" })}
            >
              <Icon name="chevron" size={14} />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={() => void patch(t.id, { isHidden: !t.isHidden })}>
              {t.isHidden ? "Show" : "Hide"}
            </Button>
          </li>
        ))}
        {!list.length && <li className="px-3 py-2 text-muted-foreground">No items yet.</li>}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void add())}>
        <label htmlFor={`lib-add-${kind}`} className="sr-only">
          New item for {l.label}
        </label>
        <Input id={`lib-add-${kind}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="New item" maxLength={60} />
        <Button type="submit" variant="outline" disabled={!name.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}

function Toggle({ id, title, help, checked, onChange }: { id: string; title: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <label htmlFor={id} className="grid gap-1 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{help}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { config } = useLibrary();
  const { state, setState, error } = useManage(!!config?.canManage);
  const toast = useToast();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (state && !draft) setDraft(structuredClone(state.settings));
  }, [state, draft]);
  const changed = useMemo(() => !!draft && !!state && JSON.stringify(draft) !== JSON.stringify(state.settings), [draft, state]);
  if (config && !config.canManage) return <NotAllowed title="Lists and settings" />;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setProblem(null);
    try {
      const next = await api<NonNullable<typeof state>>(`${API}/manage/settings`, { method: "PUT", body: draft });
      setState(next);
      setDraft(structuredClone(next.settings));
      reloadConfig();
      toast("Settings saved.");
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <SiteHeader title="Lists and settings">
      <Button size="sm" onClick={() => void save()} disabled={busy || !changed}>
        Save
      </Button>
    </SiteHeader>
  );
  if (!state || !draft)
    return (
      <>
        {header}
        <PageBody>{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Loading…</p>}</PageBody>
      </>
    );
  const d = draft;
  const set = (patch: Partial<Settings>) => setDraft({ ...d, ...patch });
  const label = (k: keyof Settings["fieldLabels"], v: string) => set({ fieldLabels: { ...d.fieldLabels, [k]: v } });

  return (
    <>
      {header}
      <PageBody className="max-w-5xl">
        <div className="grid gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Lists and settings</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Each site sets its own words and lists, so the Library fits its brand. A hidden list item stays on the items that use it, but readers cannot filter by it.
            Changes to lists save at once. Press Save for the rest.
          </p>
        </div>
        {problem && <Notice tone="error">{problem}</Notice>}
        <Group title="Lists">
          <div className="grid gap-4 md:grid-cols-3">
            {TERM_KINDS.map((k) => (
              <ListCard
                key={k}
                kind={k}
                settings={d}
                setSettings={setDraft}
                terms={state.terms}
                onChanged={(terms) => {
                  setState({ ...state, terms });
                  reloadConfig();
                }}
              />
            ))}
          </div>
        </Group>
        <Group title="Names">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field className="content-start" label="Page title" htmlFor="lib-s-title" help='The app is named "Library". This title shows on its pages.'>
              <Input id="lib-s-title" value={d.title} maxLength={40} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field className="content-start" label="Name for sources" htmlFor="lib-s-src">
              <Input id="lib-s-src" value={d.sourcesName} maxLength={40} onChange={(e) => set({ sourcesName: e.target.value })} />
            </Field>
            <Field className="content-start" label="Name for updates" htmlFor="lib-s-upd">
              <Input id="lib-s-upd" value={d.updatesName} maxLength={40} onChange={(e) => set({ updatesName: e.target.value })} />
            </Field>
          </div>
        </Group>
        <Group title="Update field labels">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Field 1" htmlFor="lib-f1">
              <Input id="lib-f1" value={d.fieldLabels.whatChanged} maxLength={40} onChange={(e) => label("whatChanged", e.target.value)} />
            </Field>
            <Field label="Field 2" htmlFor="lib-f2">
              <Input id="lib-f2" value={d.fieldLabels.whoAffected} maxLength={40} onChange={(e) => label("whoAffected", e.target.value)} />
            </Field>
            <Field label="Field 3" htmlFor="lib-f3">
              <Input id="lib-f3" value={d.fieldLabels.action} maxLength={40} onChange={(e) => label("action", e.target.value)} />
            </Field>
            <Field label="Date field" htmlFor="lib-f4">
              <Input id="lib-f4" value={d.fieldLabels.dueDate} maxLength={40} onChange={(e) => label("dueDate", e.target.value)} />
            </Field>
          </div>
        </Group>
        <Group title="Notice and review">
          <Field label="Notice under the title" htmlFor="lib-s-notice" help="Leave it empty to show no notice.">
            <Textarea id="lib-s-notice" rows={2} value={d.notice} maxLength={300} onChange={(e) => set({ notice: e.target.value })} />
          </Field>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Review checklist</span>
            {d.checklist.map((c, i) => (
              <div key={i} className="flex gap-2">
                <label htmlFor={`lib-check-${i}`} className="sr-only">
                  Check {i + 1}
                </label>
                <Input
                  id={`lib-check-${i}`}
                  value={c}
                  maxLength={160}
                  onChange={(e) => set({ checklist: d.checklist.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                <Button variant="ghost" size="icon" aria-label={`Remove check ${i + 1}`} onClick={() => set({ checklist: d.checklist.filter((_, j) => j !== i) })}>
                  <Icon name="trash" />
                </Button>
              </div>
            ))}
            <Button variant="outline" className="w-fit" disabled={d.checklist.length >= MAX_CHECKS} onClick={() => set({ checklist: [...d.checklist, ""] })}>
              <Icon name="plus" />
              Add a check
            </Button>
          </div>
          <Field label='"New" window (days)' htmlFor="lib-s-new" className="max-w-48">
            <Input
              id="lib-s-new"
              type="number"
              min={1}
              max={365}
              value={d.newDays}
              onChange={(e) => set({ newDays: Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))) })}
            />
          </Field>
          <Toggle
            id="lib-s-checked"
            title='"Last checked" date on sources'
            help="Shows when someone last checked each source against the official page. Turn it off for content that is not rules."
            checked={d.showLastChecked}
            onChange={(v) => set({ showLastChecked: v })}
          />
          <Toggle
            id="lib-s-chat"
            title="Ask (AI chat)"
            help="An AI chat on the home page that answers from the published items only, with links to them. It uses each person's own AI key, then the company key, then the site default."
            checked={d.chatOn}
            onChange={(v) => set({ chatOn: v })}
          />
          {d.chatOn && (
            <Field label="Line under the Ask box" htmlFor="lib-s-intro">
              <Input id="lib-s-intro" value={d.chatIntro} maxLength={300} onChange={(e) => set({ chatIntro: e.target.value })} />
            </Field>
          )}
          <Toggle
            id="lib-s-second"
            title="Require a second reviewer"
            help="When on, a different super admin must publish each item. Off: the writer can publish after the review checklist."
            checked={d.requireSecondReviewer}
            onChange={(v) => set({ requireSecondReviewer: v })}
          />
        </Group>
      </PageBody>
    </>
  );
}
