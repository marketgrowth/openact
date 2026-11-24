import { Icon, Link, useCloseOnPhone, usePath } from "@openact/ui";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@openact/ui/components/sidebar";
import { HOME } from "../shared/rules";
import { useMe } from "./lib";

/*
 * The WorkSpent side panel, from first principles: My time for everyone, then one section for each kind of work
 * that is on (Projects, Shifts), then Manage. Each page does one job: track, plan, approve, report or set up.
 */

type Item = { label: string; icon: string; path: string };

export const PATHS = {
  myTime: `${HOME}/my-time`,
  timeLog: `${HOME}/time-log`,
  clients: `${HOME}/clients`,
  reports: `${HOME}/reports`,
  schedule: `${HOME}/schedule`,
  timesheets: `${HOME}/timesheets`,
  locations: `${HOME}/locations`,
  team: `${HOME}/people`,
  settings: `${HOME}/settings`
};

function Group({ label, items }: { label?: string; items: Item[] }) {
  const path = usePath();
  const done = useCloseOnPhone();
  if (!items.length) return null;
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu aria-label={label ?? "WorkSpent"}>
          {items.map((i) => (
            <SidebarMenuItem key={i.path}>
              <SidebarMenuButton asChild isActive={path === i.path}>
                <Link to={i.path} onClick={done}>
                  <Icon name={i.icon} />
                  <span>{i.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function WorkSpentNav() {
  const me = useMe().data;
  // Until the answer comes, show both kinds, so the panel does not jump for most companies.
  const projects = me?.projects ?? true;
  const shifts = me?.shifts ?? true;
  const manages = !!me && (me.canManageAll || me.canSetup || me.managedLocationIds.length > 0);
  const track = !me || me.canTrack;
  return (
    <>
      <Group items={[{ label: "My time", icon: "clock", path: PATHS.myTime }]} />
      {projects && (
        <Group
          label="Projects"
          items={[
            ...(track || me?.canManageAll ? [{ label: "Time log", icon: "table", path: PATHS.timeLog }] : []),
            ...(me?.canSetup
              ? [
                  {
                    label: "Clients and projects",
                    icon: "briefcase",
                    path: PATHS.clients
                  }
                ]
              : []),
            ...(track || me?.canManageAll ? [{ label: "Reports", icon: "earnings", path: PATHS.reports }] : [])
          ]}
        />
      )}
      {shifts && manages && (
        <Group
          label="Shifts"
          items={[
            { label: "Schedule", icon: "calendar-check", path: PATHS.schedule },
            { label: "Timesheets", icon: "calendar", path: PATHS.timesheets },
            ...(me?.canSetup
              ? [
                  {
                    label: "Locations and devices",
                    icon: "monitor",
                    path: PATHS.locations
                  }
                ]
              : [])
          ]}
        />
      )}
      {me?.canSetup && (
        <Group
          label="Manage"
          items={[
            { label: "Team", icon: "users", path: PATHS.team },
            { label: "Settings", icon: "gear", path: PATHS.settings }
          ]}
        />
      )}
    </>
  );
}
