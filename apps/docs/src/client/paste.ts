import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** Matches CSS that starts a new page before or after an element, as Google Docs and Word paste it. */
const BREAK_BEFORE = /(?:^|;)\s*(?:page-break-before\s*:\s*always|break-before\s*:\s*page)/i;
const BREAK_AFTER = /(?:^|;)\s*(?:page-break-after\s*:\s*always|break-after\s*:\s*page)/i;

/**
 * Turns page breaks in pasted HTML into our page break blocks.
 * An empty element with the break, such as a line or a line break, becomes the page break.
 * An element with text keeps its text, and the page break goes before or after it.
 */
export function markPastedPageBreaks(html: string): string {
  if (!/break-(?:before|after)/i.test(html) || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const el of Array.from(doc.body.querySelectorAll("[style]"))) {
    const style = el.getAttribute("style") ?? "";
    const before = BREAK_BEFORE.test(style);
    const after = BREAK_AFTER.test(style);
    if (!before && !after) continue;
    const mark = () => {
      const d = doc.createElement("div");
      d.setAttribute("data-page-break", "");
      return d;
    };
    const empty = el.tagName === "HR" || el.tagName === "BR" || (!el.textContent?.trim() && !el.querySelector("img"));
    if (empty) el.replaceWith(mark());
    else {
      if (before) el.before(mark());
      if (after) el.after(mark());
    }
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

/** Keeps page breaks from Google Docs, Word and other apps when people paste into a doc. */
export const PastePageBreaks = Extension.create({
  name: "pastePageBreaks",
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey("pastePageBreaks"), props: { transformPastedHTML: markPastedPageBreaks } })];
  }
});
