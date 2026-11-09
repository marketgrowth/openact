import { useMemo, useState } from "react";
import { fmtDateTime, Icon, Link, Notice, PageBody, SiteHeader } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import type { DocSummary } from "../shared/types";
import { FOLDER_DEPTH_MAX } from "../shared/library";
import { ColorDot, FolderDialog, NewDocDialog } from "./library-dialogs";
import { DOCS_HOME, useDocs } from "./state";

/** Which docs a library page shows. */
export type View = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; id: string } | { kind: "category"; id: string } | { kind: "tag"; id: string };

export function LibraryPage({ view }: { view: View }) {
  const { library, error, folder, category, tag, folderTrail } = useDocs();
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dialog, setDialog] = useState<null | "doc" | "folder">(null);

  const current = view.kind === "folder" ? folder(view.id) : view.kind === "category" ? category(view.id) : view.kind === "tag" ? tag(view.id) : undefined;
  const missing = (view.kind === "folder" || view.kind === "category" || view.kind === "tag") && library && !current;
  const title =
    view.kind === "all"
      ? "All docs"
      : view.kind === "unfiled"
        ? "Not in a folder"
        : current
          ? current.name
          : view.kind === "folder"
            ? "Folder"
            : view.kind === "category"
              ? "Category"
              : "Tag";

  const docs = useMemo(() => {
    const all = library?.docs ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((d) => {
      if (view.kind === "unfiled" && d.folderId) return false;
      if (view.kind === "folder" && d.folderId !== view.id) return false;
      if (view.kind === "category" && d.categoryId !== view.id) return false;
      if (view.kind === "tag" && !d.tagIds.includes(view.id)) return false;
      if (catFilter && (catFilter === "none" ? d.categoryId : d.categoryId !== catFilter)) return false;
      if (tagFilter && !d.tagIds.includes(tagFilter)) return false;
      if (needle && !d.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [library?.docs, view, q, catFilter, tagFilter]);

  const subfolders = view.kind === "folder" ? (library?.folders ?? []).filter((f) => f.parentId === view.id).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const trail = view.kind === "folder" ? folderTrail(view.id) : [];
  const can = library?.can;

  return (
    <>
      <SiteHeader
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            {view.kind === "category" && category(view.id) && <ColorDot color={category(view.id)!.color} />}
            {view.kind === "tag" && <Icon name="tag" />}
            {view.kind === "folder" && <Icon name="folder-open" />}
            <span className="truncate">{title}</span>
          </span>
        }
      >
        {can?.organize && view.kind === "folder" && trail.length < FOLDER_DEPTH_MAX && (
          <Button variant="outline" size="sm" onClick={() => setDialog("folder")}>
            <Icon name="folder-plus" /> <span className="hidden sm:inline">New folder</span>
          </Button>
        )}
        {can?.edit && (
          <Button size="sm" onClick={() => setDialog("doc")} data-new-doc="">
            <Icon name="plus" /> <span className="hidden sm:inline">New doc</span>
          </Button>
        )}
      </SiteHeader>
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        {missing && <Notice tone="error">This {view.kind} does not exist. Someone may have deleted it.</Notice>}

        {trail.length > 0 && (
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" data-folder-trail="">
            <Link to={DOCS_HOME} className="hover:text-foreground">
              All docs
            </Link>
            {trail.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                <Icon name="right" size={14} />
                {i === trail.length - 1 ? (
                  <span className="text-foreground">{f.name}</span>
                ) : (
                  <Link to={`${DOCS_HOME}/f/${f.id}`} className="hover:text-foreground">
                    {f.name}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-docs-filters="">
          <Input
            type="search"
            className="h-8 w-full sm:max-w-xl sm:min-w-0 sm:flex-1"
            placeholder="Find a doc by title"
            aria-label="Find a doc by title"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-docs-search=""
          />
          <div className="flex shrink-0 gap-2">
            {view.kind !== "category" && (
              <NativeSelect size="sm" className="w-40" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filter by category">
                <NativeSelectOption value="">All categories</NativeSelectOption>
                <NativeSelectOption value="none">No category</NativeSelectOption>
                {(library?.categories ?? []).map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
            {view.kind !== "tag" && (library?.tags.length ?? 0) > 0 && (
              <NativeSelect size="sm" className="w-40" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filter by tag">
                <NativeSelectOption value="">All tags</NativeSelectOption>
                {(library?.tags ?? []).map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    {t.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>
        </div>

        {subfolders.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-subfolders="">
            {subfolders.map((f) => (
              <li key={f.id}>
                <Link
                  to={`${DOCS_HOME}/f/${f.id}`}
                  className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium hover:bg-muted/50"
                >
                  <Icon name="folder" className="text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground tabular">
                    {(library?.docs ?? []).filter((d) => d.folderId === f.id).length}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {!library ? (
          <p className="text-sm text-muted-foreground">Loading docs…</p>
        ) : docs.length === 0 ? (
          <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-empty="">
            <h3 className="text-lg font-semibold">{library.docs.length === 0 ? "No docs yet" : "No docs here"}</h3>
            <p className="text-sm text-muted-foreground">
              {library.docs.length === 0
                ? "Write briefs, proposals, policies and notes on pages the size of paper. Share them with a link, or print them to PDF."
                : q || catFilter || tagFilter
                  ? "No docs match. Clear the search or the filters."
                  : "Put a doc here when you make it, or move one here from its page."}
            </p>
            {can?.edit && (
              <Button onClick={() => setDialog("doc")}>
                <Icon name="plus" /> New doc
              </Button>
            )}
          </div>
        ) : (
          <DocTable docs={docs} showFolder={view.kind !== "folder" && view.kind !== "unfiled"} />
        )}
      </PageBody>

      {dialog === "doc" && (
        <NewDocDialog
          folderId={view.kind === "folder" ? view.id : null}
          categoryId={view.kind === "category" ? view.id : null}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "folder" && view.kind === "folder" && <FolderDialog parentId={view.id} onClose={() => setDialog(null)} />}
    </>
  );
}

function DocTable({ docs, showFolder }: { docs: DocSummary[]; showFolder: boolean }) {
  const { category, tag, folderTrail } = useDocs();
  return (
    <div className="overflow-x-auto rounded-xl border bg-card" data-docs="">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="hidden lg:table-cell">Tags</TableHead>
            {showFolder && <TableHead className="hidden lg:table-cell">Folder</TableHead>}
            <TableHead className="hidden sm:table-cell">Edited</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => {
            const cat = category(d.categoryId);
            const trail = folderTrail(d.folderId);
            return (
              <TableRow key={d.id} data-doc={d.id}>
                <TableCell className="max-w-0 min-w-48">
                  <Link to={`${DOCS_HOME}/d/${d.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <Icon name="doc" className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{d.title}</span>
                    {d.shared && (
                      <span className="shrink-0 text-muted-foreground" title="Shared with a link">
                        <Icon name="share" size={13} />
                      </span>
                    )}
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {cat ? (
                    <Link to={`${DOCS_HOME}/c/${cat.id}`} className="inline-flex items-center gap-1.5 text-sm hover:underline">
                      <ColorDot color={cat.color} />
                      {cat.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell className="hidden max-w-64 lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {d.tagIds.map((id) => {
                      const t = tag(id);
                      return t ? (
                        <Badge key={id} variant="secondary" asChild>
                          <Link to={`${DOCS_HOME}/t/${id}`}>{t.name}</Link>
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </TableCell>
                {showFolder && (
                  <TableCell className="hidden max-w-56 lg:table-cell">
                    {trail.length ? (
                      <Link to={`${DOCS_HOME}/f/${d.folderId}`} className="block truncate text-sm text-muted-foreground hover:text-foreground hover:underline">
                        {trail.map((f) => f.name).join(" / ")}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground sm:table-cell">
                  {fmtDateTime(d.updatedAt)}
                  {d.updatedByName ? ` by ${d.updatedByName}` : ""}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
