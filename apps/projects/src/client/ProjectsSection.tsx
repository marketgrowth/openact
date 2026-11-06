import { Icon, Link, usePath, useCloseOnPhone, useWorkspace } from "@openact/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@openact/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@openact/ui/components/sidebar";
import { canCreateProjects } from "../shared/access";
import { useProjects } from "./projects-context";

/** The current company's projects, as a group in the side panel that the person can collapse. */
export function ProjectsSection() {
  const { current } = useWorkspace();
  const { projects, newProject } = useProjects();
  const path = usePath();
  const done = useCloseOnPhone();
  const canCreate = canCreateProjects(current?.role ?? null);

  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            Projects
            <Icon name="chevron" size={14} className="ml-1 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {canCreate && (
          <SidebarGroupAction title="New project" onClick={newProject}>
            <Icon name="plus" />
            <span className="sr-only">New project</span>
          </SidebarGroupAction>
        )}
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Projects" data-nav="projects">
              {projects === null && <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Loading…</p>}
              {projects?.map((proj) => {
                const active = path === `/p/${proj.id}` || path.startsWith(`/p/${proj.id}/`);
                const label = proj.visibility === "secret" ? `${proj.name} (secret)` : proj.name;
                return (
                  <SidebarMenuItem key={proj.id}>
                    <SidebarMenuButton asChild tooltip={label} isActive={active}>
                      <Link to={`/p/${proj.id}`} onClick={done}>
                        <span className="flex size-4 items-center justify-center" aria-hidden="true">
                          <span className="size-2.5 rounded-full" style={{ background: `var(--pc-${proj.color})` }} />
                        </span>
                        <span>{proj.name}</span>
                        {proj.visibility === "secret" && (
                          <span className="ml-auto text-muted-foreground" title="Secret project">
                            <Icon name="shield" size={13} />
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {projects && !projects.length && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">No projects yet.</p>
              )}
              {canCreate && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="New project" onClick={newProject} className="text-muted-foreground">
                    <Icon name="plus" />
                    <span>New project</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
