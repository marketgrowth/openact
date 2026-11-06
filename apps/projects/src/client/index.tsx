import { lazy, useCallback, type ReactNode } from "react";
import { defineClientApp, useShell, useWorkspace } from "@openact/ui";
import type { CompanyDetail } from "../shared/types";
import { ProjectsProvider } from "./projects-context";
import { ProjectsSection } from "./ProjectsSection";
import { ProjectsPage } from "./pages/Projects";

/*
 * The projects app in the web app: the projects page, a project's board, timeline, calendar and people,
 * the Pinned, Projects and Recent groups in its panel, and task search (Ctrl+K or Cmd+K).
 */

const ProjectPage = lazy(() => import("./pages/Project").then((m) => ({ default: m.ProjectPage })));
const NewProjectDialog = lazy(() => import("./pages/Projects").then((m) => ({ default: m.NewProjectDialog })));
const SearchDialog = lazy(() => import("./components/SearchDialog").then((m) => ({ default: m.SearchDialog })));
const AiDefaultsTab = lazy(() => import("./components/AiDefaultsTab").then((m) => ({ default: m.AiDefaultsTab })));

type View = "board" | "timeline" | "calendar" | "members";

function Provider({ children }: { children: ReactNode }) {
  const shell = useShell();
  const newProject = useCallback(() => shell.runCommand("projects.new"), [shell]);
  return <ProjectsProvider onNewProject={newProject}>{children}</ProjectsProvider>;
}

function NewProject({ onClose }: { onClose: () => void }) {
  const { current } = useWorkspace();
  if (!current) return null;
  return <NewProjectDialog company={current} onClose={onClose} />;
}

function ProjectRoute({ id, view }: { id: string; view: View }) {
  const shell = useShell();
  return <ProjectPage key={id} projectId={id} view={view} me={shell.me!} config={shell.config} />;
}

function Search({ onClose }: { onClose: () => void }) {
  const { current } = useWorkspace();
  if (!current) return null;
  return <SearchDialog companyId={current.id} companyName={current.name} onClose={onClose} />;
}

export default defineClientApp({
  id: "projects",
  name: "Projects",
  icon: "projects",
  ownsPath: (path) => path === "/" || path.startsWith("/p/"),
  Provider,
  Home: ProjectsPage,
  routes: [
    {
      pattern: /^\/p\/([^/]+)(?:\/(board|timeline|calendar|members))?\/?$/,
      render: (m) => <ProjectRoute id={m[1]!} view={(m[2] as View) || "board"} />
    }
  ],
  nav: [{ label: "All projects", icon: "projects", path: "/" }],
  SidebarSection: ProjectsSection,
  commands: [
    { id: "projects.new", label: "New project", icon: "plus", inSidebar: false, Dialog: NewProject },
    { id: "projects.search", label: "Search", icon: "search", shortcut: "k", inSidebar: true, Dialog: Search }
  ],
  companySettingsTabs: [
    {
      id: "projects.ai",
      label: "AI defaults",
      Tab: ({ detail, onChanged }) => <AiDefaultsTab detail={detail as unknown as CompanyDetail} onChanged={onChanged} />
    }
  ]
});
