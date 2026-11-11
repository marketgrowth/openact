import type { ReactNode } from "react";
import { Icon, Link, usePath, useCloseOnPhone } from "@openact/ui";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@openact/ui/components/sidebar";
import { ADVISORY_HOME } from "../shared/rules";
import { Portrait } from "./bits";
import { useAdvisory } from "./state";

/** The Advisory panel: the pages, then each listed advisor with their name and role. */
export function AdvisorySection() {
  const { home, settings } = useAdvisory();
  const can = home?.can;

  return (
    <>
      <SidebarGroup data-nav="advisory-pages">
        <SidebarGroupContent>
          <SidebarMenu>
            <NavItem to={ADVISORY_HOME} icon="users">
              {settings.labelPlural}
            </NavItem>
            <NavItem to={`${ADVISORY_HOME}/my`} icon="receipt">
              My requests
            </NavItem>
            {can?.sell && (
              <NavItem to={`${ADVISORY_HOME}/me`} icon="briefcase">
                My {settings.label.toLowerCase()} page
              </NavItem>
            )}
            {can?.manage && (
              <NavItem to={`${ADVISORY_HOME}/manage`} icon="user-check">
                Manage {settings.labelPlural.toLowerCase()}
              </NavItem>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup data-nav="advisory-advisors">
        <SidebarGroupLabel>{settings.labelPlural}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {!home && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>}
            {home?.advisors.map((a) => (
              <AdvisorItem key={a.id} to={`${ADVISORY_HOME}/p/${a.id}`} id={a.id} name={a.name} role={a.headline} photo={a.photoUrl} />
            ))}
            {home && !home.advisors.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No {settings.labelPlural.toLowerCase()} are listed yet.</p>}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function NavItem({ to, icon, children }: { to: string; icon: string; children: ReactNode }) {
  const path = usePath();
  const done = useCloseOnPhone();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={path === to}>
        <Link to={to} onClick={done}>
          <Icon name={icon} />
          <span className="truncate">{children}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AdvisorItem({ to, id, name, role, photo }: { to: string; id: string; name: string; role: string; photo: string | null }) {
  const path = usePath();
  const done = useCloseOnPhone();
  return (
    <SidebarMenuItem data-advisor-item={id}>
      <SidebarMenuButton asChild isActive={path === to} size="lg">
        <Link to={to} onClick={done}>
          <Portrait id={id} name={name} url={photo} size={28} />
          <span className="grid min-w-0 leading-tight">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{role}</span>
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
