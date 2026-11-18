import { useState } from "react";
import { api, errorText, Icon, Link, useToast } from "@openact/ui";
import type { DocDetail } from "../shared/types";
import { CategorySelect, FolderSelect, TagInput } from "./library-dialogs";
import { DOCS_HOME, useDocs } from "./state";

/* Parts that the doc editor and the PDF page share. This file stays small, so the PDF page does not load the editor. */

/** The folder path of a doc, as links, for the page header. */
export function Trail({ folderId }: { folderId: string | null }) {
  const { folderTrail } = useDocs();
  const trail = folderTrail(folderId);
  return (
    <span className="flex min-w-0 items-center gap-1 text-sm" data-doc-trail="">
      <Link to={DOCS_HOME} className="shrink-0 text-muted-foreground hover:text-foreground">
        Docs
      </Link>
      {trail.map((f) => (
        <span key={f.id} className="flex min-w-0 items-center gap-1">
          <Icon name="right" size={14} className="shrink-0 text-muted-foreground" />
          <Link to={`${DOCS_HOME}/f/${f.id}`} className="truncate text-muted-foreground hover:text-foreground">
            {f.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

/** Folder, category and tags. They save at once, apart from the content, so they never clash with someone who is writing. */
export function MetaBar({
  doc,
  canEdit,
  noun = "doc"
}: {
  doc: Pick<DocDetail, "id" | "folderId" | "categoryId" | "tagIds">;
  canEdit: boolean;
  noun?: "doc" | "PDF";
}) {
  const toast = useToast();
  const { library, tag, reload } = useDocs();
  const [folderId, setFolderId] = useState(doc.folderId);
  const [categoryId, setCategoryId] = useState(doc.categoryId);
  const [tags, setTags] = useState<string[] | null>(null);
  const tagNames = tags ?? doc.tagIds.map((id) => tag(id)?.name).filter((n): n is string => !!n);

  const save = async (body: Record<string, unknown>, done: string) => {
    try {
      await api(`/api/apps/docs/docs/${doc.id}/meta`, { method: "PATCH", body });
      await reload();
      toast(done);
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]" data-doc-meta="">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Folder
        <FolderSelect
          value={folderId}
          disabled={!canEdit}
          onChange={(v) => {
            setFolderId(v);
            void save({ folderId: v }, `The ${noun} moved.`);
          }}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Category
        <CategorySelect
          value={categoryId}
          disabled={!canEdit}
          onChange={(v) => {
            setCategoryId(v);
            void save({ categoryId: v }, "The category is saved.");
          }}
        />
      </label>
      <div className="grid gap-1 text-xs font-medium text-muted-foreground">
        <span>Tags</span>
        <TagInput
          id={`doc-tags-${doc.id}`}
          value={tagNames}
          disabled={!canEdit}
          known={library?.tags ?? []}
          onChange={(names) => {
            setTags(names);
            void save({ tags: names }, "The tags are saved.");
          }}
        />
      </div>
    </div>
  );
}
