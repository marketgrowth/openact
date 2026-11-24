import { lazy } from "react";
import { Icon, Link, defineClientApp, useCloseOnPhone, usePath } from "@openact/ui";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from "@openact/ui/components/sidebar";
import { HOME } from "../shared/rules";
import { useLibrary } from "./state";

/*
 * The Library in the web app. Readers see the library and Ask. Super admins also see Manage:
 * To review, Add resource, Automations and Settings. Every brand word comes from the site's settings.
 */

const HomePage = lazy(() => import("./ReadPages").then((m) => ({ default: m.HomePage })));
const ResourcePage = lazy(() => import("./ReadPages").then((m) => ({ default: m.ResourcePage })));
const AskPage = lazy(() => import("./Ask").then((m) => ({ default: m.AskPage })));
const ManagePage = lazy(() => import("./ManagePages").then((m) => ({ default: m.ManagePage })));
const AddPage = lazy(() => import("./ManagePages").then((m) => ({ default: m.AddPage })));
const EditPage = lazy(() => import("./ManagePages").then((m) => ({ default: m.EditPage })));
const SettingsPage = lazy(() => import("./ManagePages").then((m) => ({ default: m.SettingsPage })));
const AutomationsPage = lazy(() => import("./AutomationPages").then((m) => ({ default: m.AutomationsPage })));
const NewAutomationPage = lazy(() => import("./AutomationPages").then((m) => ({ default: m.NewAutomationPage })));

function Item({ to, icon, label, badge, match }: { to: string; icon: string; label: string; badge?: string; match?: (path: string) => boolean }) {
  const path = usePath();
  const done = useCloseOnPhone();
  const active = match ? match(path) : path === to;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <Link to={to} onClick={done}>
          <Icon name={icon} />
          <span className="truncate">{label}</span>
        </Link>
      </SidebarMenuButton>
      {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function LibrarySection() {
  const { config } = useLibrary();
  const s = config?.settings;
  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu aria-label={s?.title ?? "Library"} data-nav="library">
            <Item to={HOME} icon="library" label={s?.title ?? "Library"} match={(p) => p === HOME || p.startsWith(`${HOME}/r/`) || p.startsWith(`${HOME}/ask`)} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {config?.canManage && (
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Manage the library" data-nav="library-manage">
              <Item
                to={`${HOME}/manage`}
                icon="inbox"
                label="To review"
                badge={config.toReview ? String(config.toReview) : undefined}
                match={(p) => p === `${HOME}/manage` || p.startsWith(`${HOME}/manage/r/`)}
              />
              <Item to={`${HOME}/manage/add`} icon="plus" label="Add resource" />
              <Item to={`${HOME}/manage/automations`} icon="plug" label="Automations" match={(p) => p.startsWith(`${HOME}/manage/automations`)} />
              <Item to={`${HOME}/manage/settings`} icon="gear" label="Settings" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}

export default defineClientApp({
  id: "library",
  name: "Library",
  icon: "library",
  home: HOME,
  routes: [
    { path: "/a/library", render: () => <HomePage /> },
    { path: "/a/library/ask", render: () => <AskPage /> },
    { path: "/a/library/r/:id", render: ({ id }) => <ResourcePage id={id!} /> },
    { path: "/a/library/manage", render: () => <ManagePage /> },
    { path: "/a/library/manage/add", render: () => <AddPage /> },
    { path: "/a/library/manage/r/:id", render: ({ id }) => <EditPage id={id!} /> },
    { path: "/a/library/manage/automations", render: () => <AutomationsPage /> },
    { path: "/a/library/manage/automations/new", render: () => <NewAutomationPage /> },
    { path: "/a/library/manage/settings", render: () => <SettingsPage /> }
  ],
  SidebarSection: LibrarySection
});
