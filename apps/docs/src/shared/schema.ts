import { getSchema, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { PageBreak } from "./page-break.ts";
import { CommentMark } from "./comment-mark.ts";

/*
 * The extensions that make up a doc. The editor and the collaboration room use the same list,
 * so both read and write the same document schema.
 * `collab` turns off the editor's own undo history, because the collaboration extension brings its own.
 */
export function docExtensions({ collab = false }: { collab?: boolean } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      ...(collab ? { undoRedo: false } : {})
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    Image.configure({ allowBase64: false }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    PageBreak,
    CommentMark
  ];
}

/** The ProseMirror schema of a doc. The collaboration room uses it to turn saved JSON into a shared doc and back. */
export const docSchema = () => getSchema(docExtensions());
