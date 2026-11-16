import { Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Starts a new page after the current top-level block, or after the current item of a top-level list. */
      setPageBreak: () => ReturnType;
    };
  }
}

const LISTS = ["bulletList", "orderedList", "taskList"];

/**
 * A page break. The next block starts on a new page, on screen and in print.
 * Page breaks live only at the top level of the doc. In a list, the command splits the list after the current item.
 */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },

  renderHTML() {
    return ["div", { "data-page-break": "", class: "doc-page-break", contenteditable: "false" }, ["span", {}, "Page break"]];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          const top = $from.depth >= 1 ? $from.node(1) : null;
          const breakNode = state.schema.nodes[this.name]!.create();
          // In a top-level list with more items after this one: split the list, with the break between the parts.
          if (top && LISTS.includes(top.type.name) && $from.depth >= 2 && $from.index(1) < top.childCount - 1) {
            const k = $from.index(1);
            let cut = 0;
            for (let i = 0; i <= k; i++) cut += top.child(i).nodeSize;
            const head = top.copy(top.content.cut(0, cut));
            const attrs = top.type.name === "orderedList" ? { ...top.attrs, start: (Number(top.attrs.start) || 1) + k + 1 } : top.attrs;
            const rest = top.type.create(attrs, top.content.cut(cut), top.marks);
            const from = $from.before(1);
            if (dispatch) {
              tr.replaceWith(from, $from.after(1), [head, breakNode, rest]);
              const into = from + head.nodeSize + breakNode.nodeSize;
              tr.setSelection(TextSelection.near(tr.doc.resolve(into + 1))).scrollIntoView();
            }
            return true;
          }
          const at = $from.depth >= 1 ? $from.after(1) : state.doc.content.size;
          if (dispatch) {
            tr.insert(at, [breakNode, state.schema.nodes.paragraph!.create()]);
            tr.setSelection(TextSelection.near(tr.doc.resolve(at + breakNode.nodeSize + 1))).scrollIntoView();
          }
          return true;
        }
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  }
});
