import { Node } from "@tiptap/core";

/** Page numbers for the table of contents in the editor. The page layout fills them in. */
export interface TocStorage {
  /** The page of each heading, in doc order. */
  pages: number[];
  /** Called when the page numbers change. */
  listeners: Set<() => void>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Adds a table of contents at the current top-level block. An empty paragraph is replaced. */
      insertTableOfContents: () => ReturnType;
    };
  }
  interface Storage {
    tableOfContents: TocStorage;
  }
}

/**
 * A table of contents. It lists the doc's headings, nested by level, and updates as people write.
 * A click on an entry moves to the heading. The share and print pages link the entries and show page numbers.
 * Top-level only, like a page break. It holds no content: the editor and the share page build the list.
 * The editor draws it with the node view in client/toc-view.ts.
 */
export const TableOfContents = Node.create<Record<string, never>, TocStorage>({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    return { pages: [], listeners: new Set() };
  },

  parseHTML() {
    return [{ tag: "nav[data-toc]" }];
  },

  renderHTML() {
    return ["nav", { "data-toc": "", class: "doc-toc" }];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          const toc = state.schema.nodes[this.name]!.create();
          if (dispatch) {
            const top = $from.depth >= 1 ? $from.node(1) : null;
            if (top && top.type.name === "paragraph" && top.content.size === 0) tr.replaceWith($from.before(1), $from.after(1), toc);
            else tr.insert($from.depth >= 1 ? $from.after(1) : state.doc.content.size, toc);
            tr.scrollIntoView();
          }
          return true;
        }
    };
  }
});
