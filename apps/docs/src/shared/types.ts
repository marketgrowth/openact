/*
 * Docs: types and limits that the Worker, the web app and tests share.
 * No imports from outside this folder, so tests can load it directly.
 */

export const PAGE_SIZES = ["letter", "a4", "legal"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const ORIENTATIONS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const MARGINS = ["narrow", "normal", "wide"] as const;
export type Margin = (typeof MARGINS)[number];

export interface PageSettings {
  pageSize: PageSize;
  orientation: Orientation;
  margin: Margin;
}

export const DEFAULT_PAGE: PageSettings = { pageSize: "letter", orientation: "portrait", margin: "normal" };

/** The longest doc title. */
export const TITLE_MAX = 200;
/** The largest saved doc, as JSON text. D1 rows must stay under 2 MB. */
export const CONTENT_MAX_BYTES = 1_500_000;
/** Image uploads. SVG is not allowed, because it can hold scripts. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** A node of the doc, in the Tiptap (ProseMirror) JSON format. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface DocSummary {
  id: string;
  title: string;
  folderId: string | null;
  categoryId: string | null;
  tagIds: string[];
  pageSize: PageSize;
  shared: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

export interface DocDetail extends PageSettings {
  id: string;
  companyId: string;
  title: string;
  folderId: string | null;
  categoryId: string | null;
  tagIds: string[];
  content: DocNode;
  rev: number;
  updatedAt: string;
  updatedByName: string | null;
  /** True when the person can change the doc. */
  canEdit: boolean;
  /** True when the person can make or turn off the share link. */
  canShare: boolean;
  /** The share link, or null when the doc is not shared. Only people who can share get it. */
  shareUrl: string | null;
  /** True when the doc has a share link. Everyone who can open the doc sees this. */
  shared: boolean;
  /** True when the person can read and write comments. */
  canComment: boolean;
  /** AI writing help: "on", "off" for the company, or "no_permission" for this person. */
  ai: "on" | "off" | "no_permission";
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
}

/** Colors for categories. They are the project color tokens of the theme (--pc-<color>). */
export const CATEGORY_COLORS = ["indigo", "teal", "amber", "rose", "violet", "slate"] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export interface Category {
  id: string;
  name: string;
  color: CategoryColor;
}

export interface Tag {
  id: string;
  name: string;
}

/** GET /api/apps/docs/companies/:id/library: the whole library of a company, without doc content. */
export interface Library {
  rev: number;
  folders: Folder[];
  categories: Category[];
  tags: Tag[];
  docs: DocSummary[];
  /** What the person can do. The server checks again on every change. */
  can: { edit: boolean; organize: boolean; share: boolean };
}

/** The path of an uploaded image in the app. The share page maps it to its own path. */
export const fileSrc = (fileId: string) => `/api/apps/docs/files/${fileId}`;
export const FILE_SRC = /^\/api\/apps\/docs\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The public path of a share link. The Worker answers these paths before the web app (see run_worker_first). */
export const SHARE_PREFIX = "/docs/s/";

/** The image type from the first bytes of a file, or null. The browser's type for an upload is not trusted. */
export function sniffImage(b: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** True when a share token has the shape that the server makes (32 random bytes, base64url). */
export const isShareToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);
