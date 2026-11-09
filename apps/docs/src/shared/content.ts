/*
 * Doc content: one allowlist for what a doc may hold, a cleaner for saved JSON, and a safe HTML renderer.
 *
 * The editor saves Tiptap JSON. The Worker never trusts it: sanitizeDoc() keeps only known nodes, marks and attributes,
 * and renderHtml() escapes every text and attribute. The share page and the print page use renderHtml(), so no saved
 * HTML ever reaches a browser.
 *
 * Pure module with no imports outside this folder, so the Worker, the web app and tests can use it.
 */
import { FILE_SRC, type DocNode } from "./types.ts";

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

const ALIGNS = ["left", "center", "right", "justify"] as const;
const LIMITS = { depth: 40, nodes: 60_000, textChars: 1_000_000, attrText: 500 };

type Attrs = Record<string, unknown>;
type AttrRule = (v: unknown) => unknown; // returns undefined to drop the attribute

const str =
  (max: number): AttrRule =>
  (v) =>
    typeof v === "string" ? v.slice(0, max) : undefined;
const bool: AttrRule = (v) => (typeof v === "boolean" ? v : undefined);
const int =
  (min: number, max: number): AttrRule =>
  (v) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const align: AttrRule = (v) => ((ALIGNS as readonly unknown[]).includes(v) && v !== "left" ? v : undefined);
const colwidth: AttrRule = (v) =>
  Array.isArray(v) && v.length <= 20 && v.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 3000) ? v : undefined;
const imageSrc: AttrRule = (v) => (typeof v === "string" && FILE_SRC.test(v) ? v : undefined);
const language: AttrRule = (v) => (typeof v === "string" && /^[a-z0-9+#.-]{1,30}$/i.test(v) ? v : undefined);

/** Safe link targets: web pages, email, phone, and anchors in the same doc. */
export function safeHref(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const href = v.trim();
  if (href.length > 2000 || /[\u0000-\u001f\u007f]/.test(href)) return undefined;
  if (/^#[A-Za-z0-9_-]{1,100}$/.test(href)) return href;
  if (/^mailto:[^\s<>"]+$/i.test(href) || /^tel:[0-9+().\s-]{3,40}$/i.test(href)) return href;
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Each node type, its attributes, and whether it holds inline content (text) or block content. */
const NODES: Record<string, { attrs?: Record<string, AttrRule>; inline?: boolean; leaf?: boolean }> = {
  doc: {},
  paragraph: { inline: true, attrs: { textAlign: align } },
  heading: { inline: true, attrs: { level: int(1, 4), textAlign: align } },
  text: { leaf: true },
  hardBreak: { leaf: true },
  bulletList: {},
  orderedList: { attrs: { start: int(1, 100000) } },
  listItem: {},
  taskList: {},
  taskItem: { attrs: { checked: bool } },
  blockquote: {},
  codeBlock: { inline: true, attrs: { language } },
  horizontalRule: { leaf: true },
  image: { leaf: true, attrs: { src: imageSrc, alt: str(LIMITS.attrText), title: str(LIMITS.attrText), width: int(16, 3000) } },
  table: {},
  tableRow: {},
  tableHeader: { attrs: { colspan: int(1, 20), rowspan: int(1, 50), colwidth } },
  tableCell: { attrs: { colspan: int(1, 20), rowspan: int(1, 50), colwidth } },
  details: { attrs: { open: bool } },
  detailsSummary: { inline: true },
  detailsContent: {},
  pageBreak: { leaf: true }
};

const MARKS: Record<string, Record<string, AttrRule>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: { href: safeHref }
};

export class ContentError extends Error {}

/**
 * Cleans a doc from the editor. Unknown nodes and marks are dropped, unknown attributes are dropped,
 * and images must point at a file uploaded to Docs. Throws ContentError when the doc is not a doc or is too big.
 */
export function sanitizeDoc(input: unknown): DocNode {
  if (!input || typeof input !== "object" || (input as DocNode).type !== "doc") throw new ContentError("The content must be a doc.");
  const count = { nodes: 0, chars: 0 };

  const cleanAttrs = (raw: unknown, rules: Record<string, AttrRule> | undefined): Attrs | undefined => {
    if (!rules || !raw || typeof raw !== "object") return undefined;
    const out: Attrs = {};
    for (const [k, rule] of Object.entries(rules)) {
      const v = rule((raw as Attrs)[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const walk = (raw: unknown, depth: number): DocNode | null => {
    if (!raw || typeof raw !== "object") return null;
    const n = raw as DocNode;
    const def = NODES[n.type];
    if (!def || (n.type === "doc" && depth > 0)) return null;
    if (depth > LIMITS.depth) throw new ContentError("The doc is nested too deep. Remove some nested lists or tables.");
    if (++count.nodes > LIMITS.nodes) throw new ContentError("The doc is too large. Split it into two docs.");
    const node: DocNode = { type: n.type };
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) return null;
      count.chars += n.text.length;
      if (count.chars > LIMITS.textChars) throw new ContentError("The doc is too large. Split it into two docs.");
      node.text = n.text;
      if (Array.isArray(n.marks)) {
        const marks: NonNullable<DocNode["marks"]> = [];
        for (const m of n.marks) {
          if (!m || typeof m !== "object" || !(m.type in MARKS) || marks.some((x) => x.type === m.type)) continue;
          const attrs = cleanAttrs(m.attrs, MARKS[m.type]);
          if (m.type === "link" && !attrs?.href) continue;
          marks.push(attrs ? { type: m.type, attrs } : { type: m.type });
        }
        if (marks.length) node.marks = marks;
      }
      return node;
    }
    const attrs = cleanAttrs(n.attrs, def.attrs);
    if (attrs) node.attrs = attrs;
    if (n.type === "image" && !attrs?.src) return null;
    if (!def.leaf && Array.isArray(n.content)) {
      const kids: DocNode[] = [];
      for (const k of n.content) {
        const c = walk(k, depth + 1);
        if (!c) continue;
        // Inline nodes hold only text and line breaks. Block nodes hold no text. Page breaks are top-level only.
        const kidInline = c.type === "text" || c.type === "hardBreak";
        if (!!def.inline !== kidInline) continue;
        if (c.type === "pageBreak" && n.type !== "doc") continue;
        kids.push(c);
      }
      if (kids.length) node.content = kids;
    }
    return node;
  };

  const doc = walk(input, 0);
  if (!doc?.content?.length) return structuredClone(EMPTY_DOC);
  return doc;
}

/* HTML */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** A heading's anchor id, such as "h3-project-goals". The number keeps ids unique. */
export function headingId(index: number, text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `h${index}${slug ? `-${slug}` : ""}`;
}

/** The plain text of a node. */
export function textOf(n: DocNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return " ";
  return (n.content ?? []).map(textOf).join("");
}

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
}

export interface RenderOptions {
  /** Maps an image src (an in-app file path) to the URL the page uses. Return null to leave the image out. */
  imageUrl?: (src: string) => string | null;
}

export interface Rendered {
  /** The top-level blocks, each as HTML, in order. */
  blocks: string[];
  /** Index of each top-level page break in `blocks`. */
  breaks: number[];
  /** Headings for a table of contents. */
  outline: OutlineItem[];
}

/** Renders a cleaned doc to HTML. Call sanitizeDoc() first: this function trusts node types but still escapes all text. */
export function renderHtml(doc: DocNode, opts: RenderOptions = {}): Rendered {
  const outline: OutlineItem[] = [];
  const a = (name: string, v: unknown) => (v === undefined || v === null || v === false ? "" : ` ${name}="${escapeHtml(String(v))}"`);
  const alignClass = (n: DocNode) => (n.attrs?.textAlign ? ` class="ta-${escapeHtml(String(n.attrs.textAlign))}"` : "");

  const marks = (n: DocNode): string => {
    let html = escapeHtml(n.text ?? "");
    for (const m of [...(n.marks ?? [])].reverse()) {
      switch (m.type) {
        case "bold":
          html = `<strong>${html}</strong>`;
          break;
        case "italic":
          html = `<em>${html}</em>`;
          break;
        case "underline":
          html = `<u>${html}</u>`;
          break;
        case "strike":
          html = `<s>${html}</s>`;
          break;
        case "code":
          html = `<code>${html}</code>`;
          break;
        case "link": {
          const href = safeHref(m.attrs?.href);
          if (!href) break;
          const external = !href.startsWith("#");
          html = `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ""}>${html}</a>`;
          break;
        }
      }
    }
    return html;
  };

  const kids = (n: DocNode) => (n.content ?? []).map(node).join("");

  const node = (n: DocNode): string => {
    switch (n.type) {
      case "text":
        return marks(n);
      case "hardBreak":
        return "<br>";
      case "paragraph":
        return `<p${alignClass(n)}>${kids(n)}</p>`;
      case "heading": {
        const level = Math.min(4, Math.max(1, Number(n.attrs?.level ?? 1)));
        const text = textOf(n).trim();
        const id = headingId(outline.length + 1, text);
        if (text) outline.push({ id, level, text: text.slice(0, 200) });
        return `<h${level} id="${escapeHtml(id)}"${alignClass(n)}>${kids(n)}</h${level}>`;
      }
      case "bulletList":
        return `<ul>${kids(n)}</ul>`;
      case "orderedList":
        return `<ol${n.attrs?.start && n.attrs.start !== 1 ? a("start", n.attrs.start) : ""}>${kids(n)}</ol>`;
      case "listItem":
        return `<li>${kids(n)}</li>`;
      case "taskList":
        return `<ul class="tasks">${kids(n)}</ul>`;
      case "taskItem": {
        const done = n.attrs?.checked === true;
        return `<li class="task${done ? " done" : ""}"><span class="box" role="img" aria-label="${done ? "Done" : "Not done"}">${done ? "&#10003;" : ""}</span><div>${kids(n)}</div></li>`;
      }
      case "blockquote":
        return `<blockquote>${kids(n)}</blockquote>`;
      case "codeBlock":
        return `<pre><code${n.attrs?.language ? a("data-language", n.attrs.language) : ""}>${kids(n)}</code></pre>`;
      case "horizontalRule":
        return "<hr>";
      case "image": {
        const src = typeof n.attrs?.src === "string" ? (opts.imageUrl ? opts.imageUrl(n.attrs.src) : n.attrs.src) : null;
        if (!src) return "";
        return `<img src="${escapeHtml(src)}"${a("alt", n.attrs?.alt ?? "")}${a("title", n.attrs?.title)}${a("width", n.attrs?.width)}>`;
      }
      case "table": {
        const first = n.content?.[0]?.content ?? [];
        const widths = first.flatMap((cell) => {
          const span = Number(cell.attrs?.colspan ?? 1);
          const w = Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as number[]) : [];
          return Array.from({ length: span }, (_, i) => w[i] ?? null);
        });
        const cols = widths.some((w) => w) ? `<colgroup>${widths.map((w) => (w ? `<col width="${w}">` : "<col>")).join("")}</colgroup>` : "";
        return `<div class="table-wrap"><table>${cols}<tbody>${kids(n)}</tbody></table></div>`;
      }
      case "tableRow":
        return `<tr>${kids(n)}</tr>`;
      case "tableHeader":
      case "tableCell": {
        const tag = n.type === "tableHeader" ? "th" : "td";
        const span = (k: string) => (Number(n.attrs?.[k] ?? 1) > 1 ? a(k, n.attrs![k]) : "");
        return `<${tag}${span("colspan")}${span("rowspan")}>${kids(n)}</${tag}>`;
      }
      case "details":
        return `<details${n.attrs?.open ? " open" : ""}>${kids(n)}</details>`;
      case "detailsSummary":
        return `<summary>${kids(n)}</summary>`;
      case "detailsContent":
        return `<div class="details-body">${kids(n)}</div>`;
      case "pageBreak":
        return `<div class="page-break" data-page-break="" aria-hidden="true"></div>`;
      default:
        return "";
    }
  };

  const blocks: string[] = [];
  const breaks: number[] = [];
  for (const b of doc.content ?? []) {
    if (b.type === "pageBreak") breaks.push(blocks.length);
    blocks.push(node(b));
  }
  return { blocks, breaks, outline };
}

/** Counts words, for the doc footer. */
export function wordCount(doc: DocNode): number {
  const parts: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === "text") return void parts.push(n.text ?? "");
    for (const k of n.content ?? []) walk(k);
    parts.push(" "); // Blocks and line breaks end a word.
  };
  walk(doc);
  return (parts.join("").match(/\S+/g) ?? []).length;
}
