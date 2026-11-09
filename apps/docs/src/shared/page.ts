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

export function pageBox(p: PageSettings): PageBox {
  const s = SIZES[p.pageSize];
  const k = s.unit === "in" ? PX_PER_IN : PX_PER_MM;
  let width = Math.round(s.w * k);
  let height = Math.round(s.h * k);
  if (p.orientation === "landscape") [width, height] = [height, width];
  const margin = Math.round(MARGIN_IN[p.margin] * PX_PER_IN);
  return { width, height, margin, contentHeight: height - 2 * margin, cssSize: `${s.css} ${p.orientation}` };
}

/** One top-level block, measured on screen. `forced` is true for a page break: the next block starts a new page. */
export interface Block {
  top: number;
  bottom: number;
  forced?: boolean;
}

/**
 * Splits blocks into pages. Returns the index of the first block of each page. The first page always starts at 0.
 * A block taller than a page gets a page of its own. It does not split.
 * Keep this function free of outside names: the share page sends its source to the browser.
 */
export function paginate(blocks: Block[], pageHeight: number): number[] {
  const starts = [0];
  if (!blocks.length || !(pageHeight > 0)) return starts;
  let pageTop = blocks[0].top;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const first = starts[starts.length - 1] === i;
    if (!first && !b.forced && b.bottom - pageTop > pageHeight) {
      starts.push(i);
      pageTop = b.top;
    }
    if (b.forced && i + 1 < blocks.length) {
      starts.push(i + 1);
      pageTop = blocks[i + 1].top;
    }
  }
  return starts;
}

/** The font stack for doc text. The web app loads Geist, and the share page loads it too. */
export const DOC_FONT = `"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
export const DOC_MONO = `"Geist Mono", ui-monospace, Menlo, Consolas, monospace`;

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
`;
}

/** Print rules for a page of `.sheet` elements. The sheets are already split, so each one becomes one printed page. */
export function printCss(p: PageSettings): string {
  const box = pageBox(p);
  return `
@page{size:${box.cssSize};margin:${box.margin}px;@bottom-right{content:counter(page) " / " counter(pages);font:8pt ${DOC_FONT};color:#777}}
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
