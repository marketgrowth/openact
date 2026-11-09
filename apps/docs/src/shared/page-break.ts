import { Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Starts a new page after the current top-level block. */
      setPageBreak: () => ReturnType;
    };
  }
}

/**
 * A page break. The next block starts on a new page, on screen and in print.
 * Page breaks live only at the top level of the doc, so the command inserts one after the current top-level block.
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
        ({ state, chain }) => {
          const { $from } = state.selection;
          const at = $from.depth >= 1 ? $from.after(1) : state.doc.content.size;
          return chain()
            .insertContentAt(at, [{ type: this.name }, { type: "paragraph" }])
            .setTextSelection(at + 2)
            .scrollIntoView()
            .run();
        }
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  }
});
