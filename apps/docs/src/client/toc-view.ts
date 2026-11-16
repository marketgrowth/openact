import { TextSelection } from "@tiptap/pm/state";
import { TableOfContents, type TocStorage } from "../shared/toc";

interface Heading {
  level: number;
  text: string;
  pos: number;
}

/** The table of contents in the editor: a live list of headings with their pages. */
export const TableOfContentsView = TableOfContents.extend({
  addNodeView() {
    return ({ editor }) => {
      const storage = this.storage as TocStorage;
      const dom = document.createElement("nav");
      dom.className = "doc-toc";
      dom.setAttribute("data-toc", "");
      dom.contentEditable = "false";
      let heads: Heading[] = [];
      let shown = "";
      let frame = 0;

      const render = () => {
        frame = 0;
        const list: Heading[] = [];
        editor.state.doc.descendants((n, pos) => {
          if (n.type.name !== "heading") return true;
          const text = n.textContent.trim();
          if (text) list.push({ level: Number(n.attrs.level) || 1, text: text.slice(0, 200), pos });
          return false;
        });
        const key = JSON.stringify([list.map((h) => [h.level, h.text]), storage.pages]);
        heads = list;
        if (key === shown) return;
        shown = key;
        dom.replaceChildren();
        const title = document.createElement("p");
        title.textContent = "Contents";
        dom.append(title);
        if (!list.length) {
          const none = document.createElement("p");
          none.className = "none";
          none.textContent = "Add headings to the doc. They show here.";
          dom.append(none);
          return;
        }
        const top = Math.min(...list.map((h) => h.level));
        const ol = document.createElement("ol");
        list.forEach((h, i) => {
          const li = document.createElement("li");
          li.className = `l${h.level - top + 1}`;
          const a = document.createElement("a");
          a.setAttribute("data-toc-index", String(i));
          a.setAttribute("role", "link");
          a.tabIndex = 0;
          const label = document.createElement("span");
          label.textContent = h.text;
          const pg = document.createElement("span");
          pg.className = "pg";
          pg.textContent = storage.pages[i] ? String(storage.pages[i]) : "";
          a.append(label, pg);
          li.append(a);
          ol.append(li);
        });
        dom.append(ol);
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(render);
      };

      const go = (e: Event) => {
        const a = (e.target as HTMLElement | null)?.closest?.("a[data-toc-index]");
        if (!a) return;
        if (e instanceof KeyboardEvent && e.key !== "Enter") return;
        e.preventDefault();
        const h = heads[Number(a.getAttribute("data-toc-index"))];
        if (!h) return;
        const { view } = editor;
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(h.pos + 1))));
        (view.nodeDOM(h.pos) as HTMLElement | null)?.scrollIntoView({ block: "start", behavior: "smooth" });
        view.focus();
      };
      dom.addEventListener("click", go);
      dom.addEventListener("keydown", go);

      render();
      editor.on("update", schedule);
      storage.listeners.add(schedule);

      return {
        dom,
        // Clicks and keys on an entry belong to the entry. Anywhere else, the editor can select the block.
        stopEvent: (e: Event) => !!(e.target as HTMLElement | null)?.closest?.("a[data-toc-index]"),
        ignoreMutation: () => true,
        destroy: () => {
          if (frame) cancelAnimationFrame(frame);
          editor.off("update", schedule);
          storage.listeners.delete(schedule);
        }
      };
    };
  }
});
