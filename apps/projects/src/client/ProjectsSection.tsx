import { Icon, Link, usePath, useCloseOnPhone, useWorkspace } from "@openact/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@openact/ui/components/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@openact/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@openact/ui/components/sidebar";
import type { ReactNode } from "react";
import type { ProjectSummary } from "../shared/types";
import { canCreateProjects } from "../shared/access";
import { useProjects } from "./projects-context";
import { requestOpenTask } from "./openTask";

/*
 * The projects app's panel groups: Pinned, Projects and Recent.
 * Pinned and Recent belong to the person. Projects lists the rest of the company's projects they can see.
 */
export function ProjectsSection() {
  const { current } = useWorkspace();
  const { projects, recentTasks, newProject } = useProjects();
  const canCreate = canCreateProjects(current?.role ?? null);
  const pinned = (projects ?? []).filter((p) => p.pinnedAt).sort((a, b) => a.pinnedAt!.localeCompare(b.pinnedAt!));
  const rest = (projects ?? []).filter((p) => !p.pinnedAt);
  const byId = new Map((projects ?? []).map((p) => [p.id, p]));

  return (
    <>
      {pinned.length > 0 && (
        <PanelGroup label="Pinned" nav="pinned">
          {pinned.map((p) => (
            <ProjectItem key={p.id} project={p} />
          ))}
        </PanelGroup>
      )}

      <PanelGroup
        label="Projects"
        nav="projects"
        action={
          canCreate && (
            <SidebarGroupAction title="New project" onClick={newProject}>
              <Icon name="plus" />
              <span className="sr-only">New project</span>
            </SidebarGroupAction>
          )
        }
      >
        {projects === null && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>}
        {rest.map((p) => (
          <ProjectItem key={p.id} project={p} />
        ))}
        {projects && !projects.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects yet.</p>}
        {projects && projects.length > 0 && !rest.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">All your projects are pinned.</p>}
        {canCreate && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={newProject} className="text-muted-foreground">
              <Icon name="plus" />
              <span>New project</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </PanelGroup>

      {recentTasks.length > 0 && (
        <PanelGroup label="Recent" nav="recent">
          {recentTasks.map((t) => {
            const proj = byId.get(t.projectId);
            return (
              <SidebarMenuItem key={t.taskId}>
                <RecentButton projectId={t.projectId} taskId={t.taskId} title={proj ? `${t.title} (${proj.name})` : t.title}>
                  <span className="truncate">{t.title}</span>
                </RecentButton>
              </SidebarMenuItem>
            );
          })}
        </PanelGroup>
      )}
    </>
  );
}

/** A group in the panel that the person can collapse. `nav` names it for tests and screen readers. */
function PanelGroup({ label, nav, action, children }: { label: string; nav: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            {label}
            <Icon name="chevron" size={14} className="ml-1 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu aria-label={label} data-nav={nav}>
              {children}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function ProjectItem({ project }: { project: ProjectSummary }) {
  const path = usePath();
  const done = useCloseOnPhone();
  const { isMobile } = useSidebar();
  const { setPinned } = useProjects();
  const active = path === `/p/${project.id}` || path.startsWith(`/p/${project.id}/`);
  const pinned = !!project.pinnedAt;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <Link to={`/p/${project.id}`} onClick={done}>
          <span className="flex size-4 items-center justify-center" aria-hidden="true">
            <span className="size-2.5 rounded-full" style={{ background: `var(--pc-${project.color})` }} />
          </span>
          <span>{project.name}</span>
          {project.visibility === "secret" && (
            <span className="ml-auto text-muted-foreground" title="Secret project">
              <Icon name="shield" size={13} />
            </span>
          )}
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`More for ${project.name}`}>
            <Icon name="dots" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44 rounded-lg" side={isMobile ? "bottom" : "right"} align={isMobile ? "end" : "start"}>
          <DropdownMenuItem onSelect={() => setPinned(project.id, !pinned)}>
            <Icon name={pinned ? "unpin" : "pin"} /> {pinned ? "Unpin" : "Pin to top"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function RecentButton({ projectId, taskId, title, children }: { projectId: string; taskId: string; title: string; children: ReactNode }) {
  const done = useCloseOnPhone();
  return (
    <SidebarMenuButton
      title={title}
      className="text-sidebar-foreground/80"
      onClick={() => {
        done();
        requestOpenTask(projectId, taskId);
      }}
    >
      {children}
    </SidebarMenuButton>
  );
}
