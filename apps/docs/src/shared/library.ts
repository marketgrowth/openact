/*
 * Library rules: names, folder nesting and tag lists. Pure, so the Worker, the web app and tests share them.
 */
import type { Folder } from "./types.ts";

/** The deepest a folder can be. A top-level folder is level 1. */
export const FOLDER_DEPTH_MAX = 5;
export const NAME_MAX = 80;
export const TAGS_PER_DOC_MAX = 20;
export const FOLDERS_MAX = 500;
export const CATEGORIES_MAX = 50;

/** Cleans a folder, category or tag name: one line, single spaces. Returns the name, or a problem to show. */
export function cleanName(raw: unknown, what: string): { name: string } | { problem: string } {
  if (typeof raw !== "string") return { problem: `${what} name must be text.` };
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { problem: `Type a ${what.toLowerCase()} name.` };
  if (name.length > NAME_MAX) return { problem: `${what} name is too long. Use ${NAME_MAX} characters or fewer.` };
  return { name };
}

/** The level of a folder: 1 for a top-level folder. 0 when the folder does not exist. */
export function folderDepth(folders: readonly Folder[], id: string | null): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  let cur = id ? byId.get(id) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth++;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return depth;
}

/** How many levels a folder and its subfolders take, counting the folder itself. */
export function subtreeHeight(folders: readonly Folder[], id: string): number {
  const kids = folders.filter((f) => f.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeHeight(folders, k.id))) : 0);
}

/** True when `id` is `ancestor` or sits somewhere inside it. */
export function isInside(folders: readonly Folder[], id: string | null, ancestor: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let cur = id;
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/**
 * Checks a move of folder `id` into `parentId` (null for the top level). Returns a problem to show, or null.
 * A new folder has no id yet: pass null.
 */
export function folderMoveProblem(folders: readonly Folder[], id: string | null, parentId: string | null): string | null {
  if (parentId && !folders.some((f) => f.id === parentId)) return "That folder does not exist. Load the page again.";
  if (id && parentId && isInside(folders, parentId, id)) return "A folder cannot go inside itself or one of its own folders.";
  const height = id ? subtreeHeight(folders, id) : 1;
  if (folderDepth(folders, parentId) + height > FOLDER_DEPTH_MAX) return `Folders can go ${FOLDER_DEPTH_MAX} levels deep. Choose a folder higher up.`;
  return null;
}

/** Folder paths for a menu, such as "Clients / Acme / Proposals", in tree order. */
export function folderPaths(folders: readonly Folder[]): Array<{ id: string; path: string; depth: number }> {
  const out: Array<{ id: string; path: string; depth: number }> = [];
  const walk = (parentId: string | null, prefix: string, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix} / ${f.name}` : f.name;
      out.push({ id: f.id, path, depth });
      if (depth < FOLDER_DEPTH_MAX) walk(f.id, path, depth + 1);
    }
  };
  walk(null, "", 1);
  return out;
}

/** Cleans a list of tag names from the editor: trimmed, unique without regard to case, and at most 20. */
export function cleanTagNames(raw: unknown): { names: string[] } | { problem: string } {
  if (!Array.isArray(raw)) return { problem: "Tags must be a list of names." };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const r = cleanName(t, "Tag");
    if ("problem" in r) return r;
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.name);
  }
  if (out.length > TAGS_PER_DOC_MAX) return { problem: `A doc can have up to ${TAGS_PER_DOC_MAX} tags.` };
  return { names: out };
}
