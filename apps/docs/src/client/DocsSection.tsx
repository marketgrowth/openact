import { useMemo, useState, type ReactNode } from "react";
import { api, errorText, Icon, Link, usePath, useCloseOnPhone, useToast } from "@openact/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@openact/ui/components/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@openact/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar
} from "@openact/ui/components/sidebar";
import type { Folder } from "../shared/types";
import { FOLDER_DEPTH_MAX } from "../shared/library";
import { CategoriesDialog, ColorDot, FolderDialog, TagsDialog } from "./library-dialogs";
import { DOCS_HOME, useDocs } from "./state";

/** The Docs panel: folders, categories and tags of the company library. */
export function DocsSection() {
  const { library } = useDocs();
  const [dialog, setDialog] = useState<null | { kind: "folder"; folderId?: string; parentId?: string | null } | { kind: "categories" } | { kind: "tags" }>(
    null
  );
  const organize = !!library?.can.organize;

  const counts = useMemo(() => {
    const folder = new Map<string, number>();
    const category = new Map<string, number>();
    const tag = new Map<string, number>();
    for (const d of library?.docs ?? []) {
      if (d.folderId) folder.set(d.folderId, (folder.get(d.folderId) ?? 0) + 1);
      if (d.categoryId) category.set(d.categoryId, (category.get(d.categoryId) ?? 0) + 1);
      for (const t of d.tagIds) tag.set(t, (tag.get(t) ?? 0) + 1);
    }
    return { folder, category, tag };
  }, [library?.docs]);

  if (!library) return <p className="px-4 py-2 text-xs text-muted-foreground">Loading…</p>;
  const topFolders = library.folders.filter((f) => !f.parentId).sort(byName);
  const tags = [...library.tags].sort((a, b) => (counts.tag.get(b.id) ?? 0) - (counts.tag.get(a.id) ?? 0) || a.name.localeCompare(b.name));

  return (
    <>
      <PanelGroup
        label="Folders"
        nav="docs-folders"
        action={
          organize && (
            <SidebarGroupAction title="New folder" onClick={() => setDialog({ kind: "folder", parentId: null })}>
              <Icon name="plus" />
              <span className="sr-only">New folder</span>
            </SidebarGroupAction>
          )
        }
      >
        {topFolders.map((f) => (
          <FolderItem key={f.id} folder={f} all={library.folders} counts={counts.folder} depth={1} organize={organize} onDialog={setDialog} />
        ))}
        {!topFolders.length && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{organize ? "No folders yet. Choose + to make one." : "No folders yet."}</p>
        )}
      </PanelGroup>

      <PanelGroup
        label="Categories"
        nav="docs-categories"
        action={
          organize && (
            <SidebarGroupAction title="Edit categories" onClick={() => setDialog({ kind: "categories" })}>
              <Icon name="pencil" />
              <span className="sr-only">Edit categories</span>
            </SidebarGroupAction>
          )
        }
      >
        {library.categories.map((c) => (
          <NavItem key={c.id} to={`${DOCS_HOME}/c/${c.id}`} count={counts.category.get(c.id)}>
            <span className="flex size-4 items-center justify-center">
              <ColorDot color={c.color} />
            </span>
            <span className="truncate">{c.name}</span>
          </NavItem>
        ))}
        {!library.categories.length && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{organize ? "No categories yet. Choose the pencil to add some." : "No categories yet."}</p>
        )}
      </PanelGroup>

      <PanelGroup
        label="Tags"
        nav="docs-tags"
        action={
          organize &&
          library.tags.length > 0 && (
            <SidebarGroupAction title="Edit tags" onClick={() => setDialog({ kind: "tags" })}>
              <Icon name="pencil" />
              <span className="sr-only">Edit tags</span>
            </SidebarGroupAction>
          )
        }
      >
        {tags.slice(0, 40).map((t) => (
          <NavItem key={t.id} to={`${DOCS_HOME}/t/${t.id}`} count={counts.tag.get(t.id)}>
            <Icon name="tag" />
            <span className="truncate">{t.name}</span>
          </NavItem>
        ))}
        {!tags.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet. Add tags on a doc.</p>}
      </PanelGroup>

      {dialog?.kind === "folder" && <FolderDialog folderId={dialog.folderId} parentId={dialog.parentId} onClose={() => setDialog(null)} />}
      {dialog?.kind === "categories" && <CategoriesDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "tags" && <TagsDialog onClose={() => setDialog(null)} />}
    </>
  );
}

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name);

function NavItem({ to, count, children }: { to: string; count?: number; children: ReactNode }) {
  const path = usePath();
  const done = useCloseOnPhone();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={path === to}>
        <Link to={to} onClick={done}>
          {children}
        </Link>
      </SidebarMenuButton>
      {!!count && <SidebarMenuBadge>{count}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function FolderItem({
  folder,
  all,
  counts,
  depth,
  organize,
  onDialog
}: {
  folder: Folder;
  all: Folder[];
  counts: Map<string, number>;
  depth: number;
  organize: boolean;
  onDialog: (d: { kind: "folder"; folderId?: string; parentId?: string | null }) => void;
}) {
  const path = usePath();
  const done = useCloseOnPhone();
  const toast = useToast();
  const { reload } = useDocs();
  const { isMobile } = useSidebar();
  const to = `${DOCS_HOME}/f/${folder.id}`;
  const kids = all.filter((f) => f.parentId === folder.id).sort(byName);
  const count = counts.get(folder.id);

  const remove = async () => {
    try {
      await api(`/api/apps/docs/folders/${folder.id}`, { method: "DELETE" });
      await reload();
      toast(`Deleted the folder "${folder.name}".`);
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <SidebarMenuItem data-folder={folder.id}>
      <SidebarMenuButton asChild isActive={path === to}>
        <Link to={to} onClick={done}>
          <Icon name={path === to ? "folder-open" : "folder"} />
          <span className="truncate">{folder.name}</span>
          {!!count && <span className="ml-auto pr-5 text-xs text-muted-foreground tabular">{count}</span>}
        </Link>
      </SidebarMenuButton>
      {organize && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover aria-label={`More for ${folder.name}`}>
              <Icon name="dots" />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48 rounded-lg" side={isMobile ? "bottom" : "right"} align={isMobile ? "end" : "start"}>
            {depth < FOLDER_DEPTH_MAX && (
              <DropdownMenuItem onSelect={() => onDialog({ kind: "folder", parentId: folder.id })}>
                <Icon name="folder-plus" /> New folder inside
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onDialog({ kind: "folder", folderId: folder.id })}>
              <Icon name="pencil" /> Rename or move
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={remove}>
              <Icon name="trash" /> Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {kids.length > 0 && (
        <SidebarMenuSub className="mr-0 pr-0">
          {kids.map((k) => (
            <FolderItem key={k.id} folder={k} all={all} counts={counts} depth={depth + 1} organize={organize} onDialog={onDialog} />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

/** A group in the panel that the person can collapse. */
function PanelGroup({ label, nav, action, children }: { label: string; nav: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            {label}
            <Icon name="chevron" size={14} className="ml-1 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu aria-label={label} data-nav={nav}>
              {children}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
