import { lazy } from "react";
import { defineClientApp, useShell } from "@openact/ui";
import { DocsProvider, DOCS_HOME } from "./state";
import { DocsSection } from "./DocsSection";
import { LibraryPage, type View } from "./LibraryPage";
import { NewDocDialog } from "./library-dialogs";

/*
 * Docs in the web app: its own icon in the app rail, a company library with folders, categories and tags,
 * and a paper-size editor. The editor loads only when a doc opens.
 *   /a/docs             all docs
 *   /a/docs/unfiled     docs that are not in a folder
 *   /a/docs/f/<id>      a folder
 *   /a/docs/c/<id>      a category
 *   /a/docs/t/<id>      a tag
 *   /a/docs/d/<id>      one doc
 */

const DocPage = lazy(() => import("./DocEditor").then((m) => ({ default: m.DocPage })));

const library = (view: View) => <LibraryPage key={JSON.stringify(view)} view={view} />;

function NewDoc({ onClose }: { onClose: () => void }) {
  const { me } = useShell();
  if (!me) return null;
  return <NewDocDialog onClose={onClose} />;
}

export default defineClientApp({
  id: "docs",
  name: "Docs",
  icon: "doc",
  home: DOCS_HOME,
  Provider: DocsProvider,
  routes: [
    { pattern: /^\/a\/docs\/?$/, render: () => library({ kind: "all" }) },
    { pattern: /^\/a\/docs\/unfiled\/?$/, render: () => library({ kind: "unfiled" }) },
    { pattern: /^\/a\/docs\/f\/([^/]+)\/?$/, render: (m) => library({ kind: "folder", id: m[1]! }) },
    { pattern: /^\/a\/docs\/c\/([^/]+)\/?$/, render: (m) => library({ kind: "category", id: m[1]! }) },
    { pattern: /^\/a\/docs\/t\/([^/]+)\/?$/, render: (m) => library({ kind: "tag", id: m[1]! }) },
    { pattern: /^\/a\/docs\/d\/([^/]+)\/?$/, render: (m) => <DocPage key={m[1]} docId={m[1]!} /> }
  ],
  nav: [
    { label: "All docs", icon: "library", path: DOCS_HOME },
    { label: "Not in a folder", icon: "inbox", path: `${DOCS_HOME}/unfiled` }
  ],
  SidebarSection: DocsSection,
  commands: [{ id: "docs.new", label: "New doc", icon: "plus", inSidebar: true, Dialog: NewDoc }]
});
