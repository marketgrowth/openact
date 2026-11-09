import { Mark, mergeAttributes, type Editor } from "@tiptap/core";

/*
 * The comment mark: text that a comment thread points at. It holds only the thread id.
 * Several threads can cover the same text (excludes: ""). Typing at the edge does not grow the mark (inclusive: false).
 * Share and print pages never show it.
 */
export const CommentMark = Mark.create({
  name: "comment",
  excludes: "",
  inclusive: false,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-thread"),
        renderHTML: (attrs) => (attrs.threadId ? { "data-comment-thread": attrs.threadId } : {})
      }
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-thread]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "doc-comment" }), 0];
  }
});

/** Takes the comment mark of one thread off every part of the doc. */
export function removeThreadMark(editor: Editor, threadId: string): void {
  const type = editor.schema.marks.comment;
  if (!type) return;
  const { tr, doc } = editor.state;
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) if (m.type === type && m.attrs.threadId === threadId) tr.removeMark(pos, pos + node.nodeSize, m);
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** True when the doc still has text with this thread's mark. */
export function threadHasText(editor: Editor, threadId: string): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (node.isText && node.marks.some((m) => m.type.name === "comment" && m.attrs.threadId === threadId)) found = true;
    return !found;
  });
  return found;
}
