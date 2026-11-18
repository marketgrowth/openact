/*
 * Paper: page sizes, margins, the CSS for doc content and print, and the page splitter.
 * The editor, the share page and the print page use the same numbers and the same splitter,
 * so the pages on screen match the pages in the PDF.
 * Pure module, so the Worker, the web app and tests can use it.
 */
import type { Margin, PageSettings, PageSize } from "./types.ts";

const PX_PER_IN = 96;
const PX_PER_MM = 96 / 25.4;

const SIZES: Record<PageSize, { label: string; w: number; h: number; unit: "in" | "mm"; css: string }> = {
  letter: { label: "Letter (8.5 × 11 in)", w: 8.5, h: 11, unit: "in", css: "letter" },
  a4: { label: "A4 (210 × 297 mm)", w: 210, h: 297, unit: "mm", css: "A4" },
  legal: { label: "Legal (8.5 × 14 in)", w: 8.5, h: 14, unit: "in", css: "legal" }
};

const MARGIN_IN: Record<Margin, number> = { narrow: 0.5, normal: 1, wide: 1.5 };

export const PAGE_SIZE_LABELS: Record<PageSize, string> = { letter: SIZES.letter.label, a4: SIZES.a4.label, legal: SIZES.legal.label };
export const MARGIN_LABELS: Record<Margin, string> = { narrow: "Narrow (0.5 in)", normal: "Normal (1 in)", wide: "Wide (1.5 in)" };

export interface PageBox {
  /** Page width and height in CSS pixels (96 per inch). */
  width: number;
  height: number;
  /** The margin on every side, in CSS pixels. */
  margin: number;
  /** The height for content on one page, in CSS pixels. */
  contentHeight: number;
  /** The value for the CSS @page size property, such as "letter portrait". */
  cssSize: string;
}

/** The paper part of the page settings. */
export type Paper = Pick<PageSettings, "pageSize" | "orientation" | "margin">;

export function pageBox(p: Paper): PageBox {
  const s = SIZES[p.pageSize];
  const k = s.unit === "in" ? PX_PER_IN : PX_PER_MM;
  let width = Math.round(s.w * k);
  let height = Math.round(s.h * k);
  if (p.orientation === "landscape") [width, height] = [height, width];
  const margin = Math.round(MARGIN_IN[p.margin] * PX_PER_IN);
  return { width, height, margin, contentHeight: height - 2 * margin, cssSize: `${s.css} ${p.orientation}` };
}

/**
 * One unit of the doc, measured on screen. A page can start only at a unit.
 * `forced` is true for a page break: the next unit starts a new page.
 * `keep` is true for a heading: it moves to the next page with the unit after it.
 */
export interface Block {
  top: number;
  bottom: number;
  forced?: boolean;
  keep?: boolean;
}

/** A unit and the element it was measured from. The Worker has no DOM types, so the element is `unknown` here. */
export interface Unit extends Block {
  el: unknown;
}

/** The parts of a DOM element that the splitter uses. The Worker has no DOM types, so they are listed here. */
interface DomEl {
  tagName: string;
  children: ArrayLike<DomEl>;
  rows?: ArrayLike<DomEl>;
  offsetTop: number;
  offsetHeight: number;
  offsetParent: DomEl | null;
  parentElement: DomEl | null;
  previousElementSibling: DomEl | null;
  nextSibling: DomEl | null;
  ownerDocument: { createDocumentFragment(): DomEl };
  classList: { add(name: string): void };
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelector(selector: string): DomEl | null;
  cloneNode(deep: boolean): DomEl;
  appendChild(node: DomEl): unknown;
}

/**
 * Splits units into pages. Returns the index of the first unit of each page. The first page always starts at 0.
 * A unit taller than a page gets a page of its own. It does not split.
 * Keep this function free of outside names and inner functions: the share page sends its source to the browser.
 */
export function paginate(blocks: Block[], pageHeight: number): number[] {
  const starts = [0];
  if (!blocks.length || !(pageHeight > 0)) return starts;
  let pageTop = blocks[0].top;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const last = starts[starts.length - 1];
    if (last !== i && !b.forced && b.bottom - pageTop > pageHeight) {
      let at = i;
      const prev = blocks[i - 1];
      // A heading at the bottom of a page moves down with the unit after it, when both fit on one page.
      if (i - 1 > last && prev.keep && !prev.forced && b.bottom - prev.top <= pageHeight) at = i - 1;
      starts.push(at);
      pageTop = blocks[at].top;
    }
    if (b.forced && i + 1 < blocks.length) {
      starts.push(i + 1);
      pageTop = blocks[i + 1].top;
    }
  }
  return starts;
}

/**
 * Measures the units of the doc inside `root`, in document order. Top and bottom are in pixels from the top of `root`.
 * A unit is a top-level block, but a page can also start between list items, between parts of a list item
 * (its text and its nested list), between table rows and between blocks in a quote.
 * Keep this function free of outside names and inner functions: the share page sends its source to the browser.
 */
export function pageUnits(rootEl: unknown): Unit[] {
  const root = rootEl as DomEl;
  const out: Unit[] = [];
  let base = 0;
  for (let e: DomEl | null = root; e; e = e.offsetParent) base += e.offsetTop;
  // A stack of [element, in a list item]. Children go on in reverse, so they come off in document order.
  const stack: Array<[DomEl, boolean]> = [];
  for (let k = root.children.length - 1; k >= 0; k--) stack.push([root.children[k], false]);
  while (stack.length) {
    const [el, inItem] = stack.pop()!;
    // The editor's spacers between pages are not part of the doc.
    if (el.hasAttribute("data-page-spacer")) continue;
    const tag = el.tagName;
    let kids: ArrayLike<DomEl> | null = null;
    let kidsInItem = false;
    if (el.hasAttribute("data-page-break")) {
      kids = null;
    } else if (tag === "UL" || tag === "OL") {
      kids = el.children;
      kidsInItem = true;
    } else if (tag === "TABLE") {
      kids = el.rows ?? null;
    } else if (!inItem && (tag === "BLOCKQUOTE" || (tag === "DIV" && el.querySelector(":scope > table")))) {
      kids = el.children;
    } else if (inItem && el.querySelector("ul,ol")) {
      kids = el.children;
      kidsInItem = true;
    }
    if (kids && kids.length) {
      for (let k = kids.length - 1; k >= 0; k--) stack.push([kids[k], kidsInItem]);
      continue;
    }
    let top = -base;
    for (let e: DomEl | null = el; e; e = e.offsetParent) top += e.offsetTop;
    out.push({ top, bottom: top + el.offsetHeight, forced: el.hasAttribute("data-page-break"), keep: /^H[1-6]$/.test(tag), el });
  }
  return out;
}

/**
 * Moves `at` and everything after it inside `root` into a new fragment, for the next sheet of the share page.
 * Lists, quotes and tables that hold `at` are copied without their children, so the next sheet keeps their look.
 * A numbered list goes on with the right number. A list item that goes on from the last sheet shows no bullet.
 * Keep this function free of outside names and inner functions: the share page sends its source to the browser.
 */
export function splitAt(rootEl: unknown, atEl: unknown): unknown {
  const root = rootEl as DomEl;
  let at = atEl as DomEl;
  // When nothing comes before `at` in its parent, move the parent, so no empty copy stays behind.
  // A table's column widths come before its first row and do not count.
  while (at.parentElement && at.parentElement !== root && (!at.previousElementSibling || at.previousElementSibling.tagName === "COLGROUP")) at = at.parentElement;
  const out = root.ownerDocument.createDocumentFragment();
  let cur: DomEl = at;
  let built: DomEl | null = null;
  for (;;) {
    const parent = cur.parentElement;
    if (!parent) return out;
    const top = parent === root;
    let box: DomEl = out;
    if (!top) {
      const copy = parent.cloneNode(false);
      copy.removeAttribute("id");
      if (parent.tagName === "OL") {
        let n = 0;
        for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) n++;
        copy.setAttribute("start", String((parseInt(parent.getAttribute("start") || "1", 10) || 1) + n));
      }
      if (parent.tagName === "TABLE") {
        const cols = parent.querySelector(":scope > colgroup");
        if (cols) copy.appendChild(cols.cloneNode(true));
      }
      box = copy;
    }
    let next = cur.nextSibling;
    if (built) {
      if (cur.tagName === "LI") built.classList.add("cont");
      box.appendChild(built);
    } else {
      box.appendChild(cur);
    }
    while (next) {
      const after: DomEl | null = next.nextSibling;
      box.appendChild(next);
      next = after;
    }
    if (top) return out;
    built = box;
    cur = parent;
  }
}

/** The font stack for doc text. The web app loads Open Sans, and the share page loads it too. */
export const DOC_FONT = `"Open Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
export const DOC_MONO = `"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace`;

/**
 * CSS for doc content inside `scope`, such as ".doc-content". Colors come from variables, so each page sets its own:
 * --doc-fg, --doc-muted, --doc-border, --doc-soft (code and table header backgrounds) and --doc-link.
 */
export function contentCss(scope: string): string {
  const s = scope;
  return `
${s}{font-family:${DOC_FONT};font-size:11pt;line-height:1.5;color:var(--doc-fg);overflow-wrap:break-word}
${s} > :first-child{margin-top:0}
${s} p{margin:0 0 .65em}
${s} h1,${s} h2,${s} h3,${s} h4{line-height:1.25;margin:1.1em 0 .45em;font-weight:650;letter-spacing:-.01em}
${s} h1{font-size:22pt}${s} h2{font-size:16pt}${s} h3{font-size:13pt}${s} h4{font-size:11pt}
${s} ul,${s} ol{margin:0 0 .65em;padding-left:1.5em}
${s} ul{list-style:disc}${s} ol{list-style:decimal}${s} ul ul{list-style:circle}${s} ol ol{list-style:lower-alpha}
${s} li > p{margin:0 0 .2em}
${s} ul.tasks,${s} ul[data-type="taskList"]{list-style:none;padding-left:.2em}
${s} li.task,${s} ul[data-type="taskList"] > li{display:flex;gap:.5em;align-items:flex-start}
${s} li.task > div,${s} ul[data-type="taskList"] > li > div{flex:1;min-width:0}
${s} li.task .box{display:inline-flex;align-items:center;justify-content:center;flex:none;width:1em;height:1em;margin-top:.25em;border:1.5px solid var(--doc-muted);border-radius:3px;font-size:.75em;line-height:1}
${s} li.task.done > div,${s} ul[data-type="taskList"] > li[data-checked="true"] > div{color:var(--doc-muted);text-decoration:line-through}
${s} ul[data-type="taskList"] > li > label{flex:none;margin-top:.15em}
${s} blockquote{margin:0 0 .65em;padding-left:1em;border-left:3px solid var(--doc-border);color:var(--doc-muted)}
${s} code{font-family:${DOC_MONO};font-size:.9em;background:var(--doc-soft);border-radius:4px;padding:.1em .3em}
${s} pre{font-family:${DOC_MONO};font-size:9.5pt;line-height:1.45;background:var(--doc-soft);border-radius:6px;padding:.75em 1em;margin:0 0 .65em;white-space:pre-wrap}
${s} pre code{background:none;padding:0;font-size:inherit}
${s} hr{border:0;border-top:1px solid var(--doc-border);margin:1.2em 0}
${s} a{color:var(--doc-link);text-decoration:underline;text-underline-offset:2px}
${s} img{max-width:100%;height:auto;display:block;margin:0 0 .65em}
${s} .table-wrap,${s} .tableWrapper{overflow-x:auto;margin:0 0 .65em}
${s} table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:10pt}
${s} th,${s} td{border:1px solid var(--doc-border);padding:4px 8px;vertical-align:top;text-align:left}
${s} th{background:var(--doc-soft);font-weight:600}
${s} th > p,${s} td > p{margin:0}
${s} details{border:1px solid var(--doc-border);border-radius:6px;padding:.4em .8em;margin:0 0 .65em}
${s} details > summary{cursor:pointer;font-weight:600}
${s} details[open] > summary{margin-bottom:.4em}
${s} .details-body > :last-child,${s} [data-type="detailsContent"] > :last-child{margin-bottom:0}
${s} .ta-center{text-align:center}
${s} .ta-right{text-align:right}${s} .ta-justify{text-align:justify}
${s} .doc-toc{margin:0 0 1.2em}
${s} .doc-toc > p{font-weight:650;font-size:13pt;margin:0 0 .5em}
${s} .doc-toc ol{list-style:none;margin:0;padding:0}
${s} .doc-toc li{margin:0 0 .25em}
${s} .doc-toc .l2{padding-left:1.25em}${s} .doc-toc .l3{padding-left:2.5em}${s} .doc-toc .l4{padding-left:3.75em}
${s} .doc-toc a{display:flex;align-items:baseline;gap:.35em;color:inherit;text-decoration:none;cursor:pointer}
${s} .doc-toc a:hover > span:first-child{text-decoration:underline}
${s} .doc-toc a::after{content:"";order:1;flex:1;border-bottom:1px dotted var(--doc-muted);min-width:1em}
${s} .doc-toc .pg{order:2;font-variant-numeric:tabular-nums;color:var(--doc-muted)}
${s} .doc-toc .none{color:var(--doc-muted)}
`;
}

/** The gap between sheets on screen, in CSS pixels. */
export const SHEET_GAP = 24;

/** A header or footer for one page, with {page}, {total} and {title} filled in. */
export function fillHeader(text: string, page: number, total: number, title: string): string {
  return text.replace(/\{(page|total|title)\}/g, (_, k: string) => (k === "page" ? String(page) : k === "total" ? String(total) : title));
}

/** True when the page shows the header and footer. */
export const showsHeader = (p: Pick<PageSettings, "hideFirst">, page: number) => !(p.hideFirst && page === 1);

/** A CSS string value. Escapes quotes, backslashes, new lines and "<", so the text cannot end the style element. */
const cssString = (s: string) => `"${s.replace(/[\\"<>\n\r]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `)}"`;

/** The CSS content value for a header or footer in print: page numbers come from the print counters. */
export function headerContent(text: string, title: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(page|total|title)\}/g)) {
    if (m.index! > last) parts.push(cssString(text.slice(last, m.index)));
    parts.push(m[1] === "page" ? "counter(page)" : m[1] === "total" ? "counter(pages)" : cssString(title));
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(cssString(text.slice(last)));
  return parts.join(" ") || "none";
}

/** Print rules for a page of `.sheet` elements. The sheets are already split, so each one becomes one printed page. */
export function printCss(p: Paper & Partial<PageSettings>, title = ""): string {
  const box = pageBox(p);
  const font = `font:8pt ${DOC_FONT};color:#666`;
  const header = (p.header ?? "").trim();
  const footer = (p.footer ?? "").trim();
  const head = header ? `@top-right{content:${headerContent(header, title)};${font}}` : "";
  const foot = footer ? `@bottom-right{content:${headerContent(footer, title)};${font}}` : "";
  const first = p.hideFirst && (head || foot) ? `@page :first{@top-right{content:none}@bottom-right{content:none}}` : "";
  return `
@page{size:${box.cssSize};margin:${box.margin}px;${head}${foot}}
${first}
@media print{
  html,body{background:none!important}
  .no-print{display:none!important}
  .desk{padding:0!important;gap:0!important;display:block!important}
  .sheet{width:auto!important;height:auto!important;min-height:0!important;padding:0!important;margin:0!important;box-shadow:none!important;border:0!important;border-radius:0!important;break-after:page}
  .sheet:last-child{break-after:auto}
  .page-break{display:none}
  details > :not(summary){display:block}
  h1,h2,h3,h4{break-after:avoid}
  tr,img,pre,blockquote,li{break-inside:avoid}
  p{orphans:3;widows:3}
  a{color:inherit}
}`;
}
