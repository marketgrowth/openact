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
  /** Header and footer text for each page. Plain text. {page}, {total} and {title} are filled in. Empty for none. */
  header: string;
  footer: string;
  /** True to leave the header and footer off the first page. */
  hideFirst: boolean;
}

export const DEFAULT_PAGE: PageSettings = { pageSize: "letter", orientation: "portrait", margin: "normal", header: "", footer: "{page} / {total}", hideFirst: false };

/** The longest header or footer. */
export const HEADER_MAX = 200;

/** The longest doc title. */
export const TITLE_MAX = 200;
/** The largest saved doc, as JSON text. D1 rows must stay under 2 MB. */
export const CONTENT_MAX_BYTES = 1_500_000;
/** Image uploads. SVG is not allowed, because it can hold scripts. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** What a library item is: a doc written in the editor, or an uploaded PDF. */
export const DOC_KINDS = ["doc", "pdf"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** The largest PDF upload. The Worker reads the whole file into memory, so keep it well under the 128 MB memory limit. */
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_MAX_LABEL = "25 MB";
/** The most PDFs one upload dialog sends. */
export const PDF_UPLOAD_MAX_FILES = 20;
/** The longest file name that Docs keeps. */
export const FILE_NAME_MAX = 200;

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
  kind: DocKind;
  title: string;
  /** The size of a PDF's file in bytes. Null for a doc. */
  size: number | null;
  folderId: string | null;
  categoryId: string | null;
  tagIds: string[];
  pageSize: PageSize;
  shared: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

/** The current file of a PDF. */
export interface PdfFile {
  /** Changes with each new upload. Add it to the file URL, so the browser never shows an old copy. */
  fileId: string;
  name: string;
  size: number;
  uploadedAt: string;
}

export interface DocDetail extends PageSettings {
  id: string;
  companyId: string;
  kind: DocKind;
  /** The current file when kind is "pdf". Null for a doc. */
  pdf: PdfFile | null;
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
  /** True when this deploy has live editing (the DOCS_ROOMS Durable Object). Without it, Docs saves the usual way. */
  collab: boolean;
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

/** True when the bytes are a PDF. The browser's type for an upload is not trusted. */
export function sniffPdf(b: Uint8Array): boolean {
  // The PDF header is "%PDF-". Some writers put a few bytes before it, and readers allow that in the first 1024 bytes.
  const max = Math.min(b.length - 5, 1024);
  for (let i = 0; i <= max; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true;
  }
  return false;
}

/** A safe file name for a PDF: no folders, no control characters, and it ends in .pdf. */
export function cleanFileName(raw: unknown): string {
  let name = typeof raw === "string" ? raw : "";
  name = name
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\.pdf$/i.test(name)) name = `${name || "document"}.pdf`;
  if (name.length > FILE_NAME_MAX) name = `${name.slice(0, FILE_NAME_MAX - 4).trim()}.pdf`;
  return name;
}

/** A title from a file name: the name without .pdf, with underscores as spaces. */
export function titleFromFileName(name: string): string {
  const t = name
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, TITLE_MAX) || "Untitled PDF";
}

/** File sizes for people: 820 KB, 4.2 MB. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when a share token has the shape that the server makes (32 random bytes, base64url). */
export const isShareToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);
