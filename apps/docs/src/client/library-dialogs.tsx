import { useMemo, useState, type KeyboardEvent } from "react";
import { api, ConfirmButton, errorText, Field, Icon, Modal, navigate, Notice, useToast, useWorkspace } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Badge } from "@openact/ui/components/badge";
import { CATEGORY_COLORS, PAGE_SIZES, TITLE_MAX, type CategoryColor, type PageSize, type Tag } from "../shared/types";
import { NAME_MAX, TAGS_PER_DOC_MAX, folderPaths } from "../shared/library";
import { PAGE_SIZE_LABELS } from "../shared/page";
import { DOCS_HOME, useDocs } from "./state";

/* Dialogs for the library: new doc, folder names, categories and tags. Plus the folder and category pickers and the tag input. */

const COLOR_LABELS: Record<CategoryColor, string> = { indigo: "Indigo", teal: "Teal", amber: "Amber", rose: "Rose", violet: "Violet", slate: "Slate" };

export function ColorDot({ color, className }: { color: CategoryColor; className?: string }) {
  return <span className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`} style={{ background: `var(--pc-${color})` }} aria-hidden="true" />;
}

/** A folder menu with the full path of each folder. */
export function FolderSelect({
  id,
  value,
  onChange,
  disabled,
  exclude
}: {
  id?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  exclude?: string;
}) {
  const { library } = useDocs();
  const paths = useMemo(() => folderPaths(library?.folders ?? []), [library?.folders]);
  return (
    <NativeSelect id={id} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className="w-full" data-folder-select="">
      <NativeSelectOption value="">No folder</NativeSelectOption>
      {paths
        .filter((p) => !exclude || p.id !== exclude)
        .map((p) => (
          <NativeSelectOption key={p.id} value={p.id}>
            {p.path}
          </NativeSelectOption>
        ))}
    </NativeSelect>
  );
}

export function CategorySelect({
  id,
  value,
  onChange,
  disabled
}: {
  id?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const { library } = useDocs();
  return (
    <NativeSelect id={id} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className="w-full" data-category-select="">
      <NativeSelectOption value="">No category</NativeSelectOption>
      {(library?.categories ?? []).map((c) => (
        <NativeSelectOption key={c.id} value={c.id}>
          {c.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Tags as chips. Type a name and press Enter or comma to add it. A new name makes a new tag when the doc saves. */
export function TagInput({
  id,
  value,
  onChange,
  disabled,
  known
}: {
  id?: string;
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
  known: Tag[];
}) {
  const [draft, setDraft] = useState("");
  const listId = `${id ?? "tags"}-known`;
  const add = (raw: string) => {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    setDraft("");
    if (!name || value.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    if (value.length >= TAGS_PER_DOC_MAX) return;
    // Use the existing tag's spelling, so "Q1" does not become "q1".
    const existing = known.find((t) => t.name.toLowerCase() === name.toLowerCase());
    onChange([...value, existing?.name ?? name]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div
      className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
      data-tag-input=""
    >
      {value.map((name) => (
        <Badge key={name.toLowerCase()} variant="secondary" className="gap-1">
          <Icon name="tag" size={11} />
          {name}
          {!disabled && (
            <button
              type="button"
              className="ml-0.5 rounded-sm hover:text-foreground"
              aria-label={`Remove tag ${name}`}
              onClick={() => onChange(value.filter((v) => v !== name))}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </Badge>
      ))}
      {!disabled && value.length < TAGS_PER_DOC_MAX && (
        <input
          id={id}
          list={listId}
          value={draft}
          maxLength={NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? "" : "Add a tag"}
          className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label="Add a tag"
        />
      )}
      <datalist id={listId}>
        {known.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
    </div>
  );
}

/** Makes a doc, then opens it. */
export function NewDocDialog({ folderId, categoryId, onClose }: { folderId?: string | null; categoryId?: string | null; onClose: () => void }) {
  const toast = useToast();
  const { current } = useWorkspace();
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState<string | null>(folderId ?? null);
  const [category, setCategory] = useState<string | null>(categoryId ?? null);
  const [pageSize, setPageSize] = useState<PageSize>("letter");
  const [busy, setBusy] = useState(false);
  const { library } = useDocs();
  if (!current) return null;
  if (library && !library.can.edit)
    return (
      <Modal title="New doc" onClose={onClose}>
        <Notice tone="info">Your role in this company cannot make docs. Ask a company owner or admin for the Write docs permission.</Notice>
      </Modal>
    );
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: string }>(`/api/apps/docs/companies/${current.id}/docs`, { body: { title, folderId: folder, categoryId: category, pageSize } });
      onClose();
      navigate(`${DOCS_HOME}/d/${r.id}`);
    } catch (err) {
      toast(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="New doc" onClose={onClose}>
      <form className="grid gap-4" onSubmit={create} data-new-doc-form="">
        <Field label="Title" htmlFor="new-doc-title">
          <Input id="new-doc-title" autoFocus value={title} maxLength={TITLE_MAX} placeholder="Untitled doc" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Folder" htmlFor="new-doc-folder">
            <FolderSelect id="new-doc-folder" value={folder} onChange={setFolder} />
          </Field>
          <Field label="Category" htmlFor="new-doc-category">
            <CategorySelect id="new-doc-category" value={category} onChange={setCategory} />
          </Field>
        </div>
        <Field label="Paper size" htmlFor="new-doc-size">
          <NativeSelect id="new-doc-size" value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSize)} className="w-full">
            {PAGE_SIZES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {PAGE_SIZE_LABELS[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Make doc
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Makes a folder, or renames and moves one. */
export function FolderDialog({ folderId, parentId, onClose }: { folderId?: string; parentId?: string | null; onClose: () => void }) {
  const toast = useToast();
  const { current } = useWorkspace();
  const { folder, reload } = useDocs();
  const existing = folder(folderId);
  const [name, setName] = useState(existing?.name ?? "");
  const [parent, setParent] = useState<string | null>(existing ? existing.parentId : (parentId ?? null));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!current) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (existing) {
        await api(`/api/apps/docs/folders/${existing.id}`, { method: "PATCH", body: { name, parentId: parent } });
        toast("The folder is saved.");
      } else {
        const r = await api<{ id: string }>(`/api/apps/docs/companies/${current.id}/folders`, { body: { name, parentId: parent } });
        navigate(`${DOCS_HOME}/f/${r.id}`);
      }
      await reload();
      onClose();
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Modal title={existing ? "Edit folder" : "New folder"} onClose={onClose}>
      <form className="grid gap-4" onSubmit={save} data-folder-form="">
        <Field label="Name" htmlFor="folder-name">
          <Input id="folder-name" autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Proposals" />
        </Field>
        <Field label="Inside" htmlFor="folder-parent" help="Folders can go 5 levels deep.">
          <FolderSelect id="folder-parent" value={parent} onChange={setParent} exclude={existing?.id} />
        </Field>
        {problem && <Notice tone="error">{problem}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {existing ? "Save folder" : "Make folder"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Adds, renames, recolors and deletes categories. */
export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { current } = useWorkspace();
  const { library, reload } = useDocs();
  const [name, setName] = useState("");
  const [color, setColor] = useState<CategoryColor>("indigo");
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of library?.docs ?? []) if (d.categoryId) m.set(d.categoryId, (m.get(d.categoryId) ?? 0) + 1);
    return m;
  }, [library?.docs]);
  if (!current) return null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast(done);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Categories"
      description="A category says what kind of doc it is, such as Proposal, Policy or Meeting notes. A doc has one category or none."
      onClose={onClose}
    >
      <ul className="grid gap-2" data-categories="">
        {(library?.categories ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-lg border p-2" data-category={c.id}>
            <NativeSelect
              size="sm"
              className="w-28"
              value={c.color}
              aria-label={`Color of ${c.name}`}
              disabled={busy}
              onChange={(e) => run(() => api(`/api/apps/docs/categories/${c.id}`, { method: "PATCH", body: { color: e.target.value } }), "The color is saved.")}
            >
              {CATEGORY_COLORS.map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {COLOR_LABELS[k]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <ColorDot color={c.color} />
            <Input
              defaultValue={c.name}
              maxLength={NAME_MAX}
              className="h-8 flex-1"
              aria-label={`Name of ${c.name}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.name) run(() => api(`/api/apps/docs/categories/${c.id}`, { method: "PATCH", body: { name: v } }), "The category is renamed.");
              }}
            />
            <span className="w-14 text-right text-xs text-muted-foreground tabular">{counts.get(c.id) ?? 0} docs</span>
            <ConfirmButton
              label={<Icon name="trash" />}
              confirmLabel="Delete"
              disabled={busy}
              onConfirm={() =>
                run(() => api(`/api/apps/docs/categories/${c.id}`, { method: "DELETE" }), "The category is deleted. Its docs now have no category.")
              }
            />
          </li>
        ))}
        {!library?.categories.length && <p className="text-sm text-muted-foreground">No categories yet.</p>}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api(`/api/apps/docs/companies/${current.id}/categories`, { body: { name, color } });
            setName("");
          }, "The category is added.");
        }}
      >
        <Field label="New category" htmlFor="new-category">
          <Input id="new-category" value={name} maxLength={NAME_MAX} placeholder="Proposal" onChange={(e) => setName(e.target.value)} />
        </Field>
        <NativeSelect value={color} className="w-28" aria-label="Color of the new category" onChange={(e) => setColor(e.target.value as CategoryColor)}>
          {CATEGORY_COLORS.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {COLOR_LABELS[k]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" disabled={busy || !name.trim()}>
          <Icon name="plus" /> Add
        </Button>
      </form>
    </Modal>
  );
}

/** Renames and deletes tags. Editors make tags on docs. */
export function TagsDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { library, reload } = useDocs();
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of library?.docs ?? []) for (const t of d.tagIds) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [library?.docs]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast(done);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tags" description="Editors add tags on a doc. Here you can rename a tag or delete it from every doc." onClose={onClose}>
      <ul className="grid max-h-[50vh] gap-2 overflow-y-auto" data-tags="">
        {(library?.tags ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-lg border p-2" data-tag={t.id}>
            <Icon name="tag" className="text-muted-foreground" />
            <Input
              defaultValue={t.name}
              maxLength={NAME_MAX}
              className="h-8 flex-1"
              aria-label={`Name of tag ${t.name}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== t.name) run(() => api(`/api/apps/docs/tags/${t.id}`, { method: "PATCH", body: { name: v } }), "The tag is renamed.");
              }}
            />
            <span className="w-14 text-right text-xs text-muted-foreground tabular">{counts.get(t.id) ?? 0} docs</span>
            <ConfirmButton
              label={<Icon name="trash" />}
              confirmLabel="Delete"
              disabled={busy}
              onConfirm={() => run(() => api(`/api/apps/docs/tags/${t.id}`, { method: "DELETE" }), "The tag is deleted.")}
            />
          </li>
        ))}
        {!library?.tags.length && <p className="text-sm text-muted-foreground">No tags yet. Add tags on a doc.</p>}
      </ul>
    </Modal>
  );
}
