/*
 * Real pages in the editor. The doc stays one column of content. Sheets of paper are drawn behind it,
 * and spacers push the first block of each page to the top of its sheet.
 * Spacers are decorations, not content: they are never saved and never reach the shared doc in live editing.
 * The splitter is the same one the share page uses, so a page in the editor is a page in print.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { pageUnits, paginate, SHEET_GAP, type PageBox } from "../shared/page";

/** A space before the block at `pos`. Before a table row, the spacer is a row that spans the table's `cols` columns. */
export interface Spacer {
  pos: number;
  height: number;
  row: boolean;
  cols: number;
}

export const spacerKey = new PluginKey<DecorationSet>("docPageSpacers");

function spacerDom(height: number, row: boolean, cols: number): HTMLElement {
  if (row) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-page-spacer", "");
    tr.className = "doc-page-spacer";
    const td = document.createElement("td");
    // Exactly the table's columns: a wider span would add columns and squeeze the real ones.
    td.colSpan = Math.max(1, cols);
    td.style.height = `${height}px`;
    tr.append(td);
    return tr;
  }
  const div = document.createElement("div");
  div.setAttribute("data-page-spacer", "");
  div.className = "doc-page-spacer";
  div.style.height = `${height}px`;
  return div;
}

/** Draws the spacers that the layout asks for. A transaction with spacers as its meta replaces them all. */
export const PageSpacers = Extension.create({
  name: "pageSpacers",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: spacerKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(spacerKey) as Spacer[] | undefined;
            if (!next) return set.map(tr.mapping, tr.doc);
            return DecorationSet.create(
              tr.doc,
              next
                .filter((s) => s.pos >= 0 && s.pos <= tr.doc.content.size)
                .map((s) => Decoration.widget(s.pos, () => spacerDom(s.height, s.row, s.cols), {
                    side: -1,
                    key: `page-spacer-${s.row ? `r${s.cols}` : "b"}-${s.height}`,
                    ignoreSelection: true
                  }))
            );
          }
        },
        props: { decorations: (state) => spacerKey.getState(state) }
      })
    ];
  }
});

/** The position before the node that `el` draws, or null. Walks up when `el` is only part of a node. */
function nodeStart(view: EditorView, el: Element): number | null {
  const size = view.state.doc.content.size;
  for (let e: Element | null = el; e && e !== view.dom; e = e.parentElement) {
    let pos: number;
    try {
      pos = view.posAtDOM(e, 0);
    } catch {
      continue;
    }
    for (const p of [pos - 1, pos]) if (p >= 0 && p < size && view.nodeDOM(p) === e) return p;
    const $p = view.state.doc.resolve(Math.min(Math.max(pos, 0), size));
    for (let d = $p.depth; d > 0; d--) if (view.nodeDOM($p.before(d)) === e) return $p.before(d);
  }
  return null;
}

/** Top of an element in pixels from the top of `root`, from layout offsets, so zoom does not change it. */
function topIn(el: HTMLElement, base: number): number {
  let top = -base;
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) top += e.offsetTop;
  return top;
}

export interface PageLayout {
  /** The number of pages. */
  pages: number;
  /** The height of all sheets with their gaps, in CSS pixels. */
  height: number;
  /** The page of each heading with text, in doc order, for the table of contents. */
  headingPages: number[];
}

/**
 * Measures the doc and works out the spacers for each page.
 * It reads the doc with the current spacers taken out, so it can run again after they are drawn.
 * Margins next to a spacer can make the first run a few pixels off. The next run corrects it.
 */
export function layoutPages(view: EditorView, box: PageBox): { spacers: Spacer[]; layout: PageLayout } {
  const root = view.dom as HTMLElement;
  const base = topIn(root, 0);
  const pitch = box.height + SHEET_GAP;
  const units = pageUnits(root);
  const drawn = Array.from(root.querySelectorAll<HTMLElement>("[data-page-spacer]"))
    .map((el) => ({ top: topIn(el, base), height: el.offsetHeight }))
    .sort((a, b) => a.top - b.top);

  // The doc as it would be without spacers.
  let shift = 0;
  let j = 0;
  const flat = units.map((u) => {
    while (j < drawn.length && drawn[j]!.top <= u.top + 0.5) shift += drawn[j++]!.height;
    return { top: u.top - shift, bottom: u.bottom - shift, forced: u.forced, keep: u.keep };
  });
  const starts = paginate(flat, box.contentHeight);

  const spacers: Spacer[] = [];
  let added = 0;
  for (let k = 1; k < starts.length; k++) {
    const i = starts[k]!;
    const height = Math.max(0, Math.round(k * pitch - (flat[i]!.top + added)));
    added += height;
    if (!height) continue;
    const el = units[i]!.el as Element;
    const pos = nodeStart(view, el);
    const row = el.tagName === "TR";
    const cols = row ? Array.from((el as HTMLTableRowElement).cells).reduce((n, c) => n + c.colSpan, 0) : 0;
    if (pos !== null) spacers.push({ pos, height, row, cols });
  }

  const pages = Math.max(1, starts.length);
  const headingPages = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4"))
    .filter((h) => !h.closest("[data-toc]") && h.textContent?.trim())
    .map((h) => Math.floor(topIn(h, base) / pitch) + 1);
  const height = Math.max(pages * pitch - SHEET_GAP, root.offsetHeight + 2 * box.margin);
  return { spacers, layout: { pages, height, headingPages } };
}

/** True when two spacer lists draw the same thing, to within a pixel. */
export function sameSpacers(a: Spacer[], b: Spacer[]): boolean {
  return a.length === b.length && a.every((s, i) => s.pos === b[i]!.pos && s.row === b[i]!.row && s.cols === b[i]!.cols && Math.abs(s.height - b[i]!.height) <= 1);
}
