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
 * The Library in the web app. Readers see the sources and the updates. Super admins also see Manage.
 * Every word in the panel and the pages comes from the site's brand settings.
 */

const SourcesPage = lazy(() => import("./ReadPages").then((m) => ({ default: m.SourcesPage })));
const UpdatesPage = lazy(() => import("./ReadPages").then((m) => ({ default: m.UpdatesPage })));
const SourcePage = lazy(() => import("./ReadPages").then((m) => ({ default: m.SourcePage })));
const UpdatePage = lazy(() => import("./ReadPages").then((m) => ({ default: m.UpdatePage })));
const ManagePage = lazy(() => import("./ManagePages").then((m) => ({ default: m.ManagePage })));
const EditorPage = lazy(() => import("./ManagePages").then((m) => ({ default: m.EditorPage })));
const SettingsPage = lazy(() => import("./ManagePages").then((m) => ({ default: m.SettingsPage })));

function Item({ to, icon, label, badge, exact = true }: { to: string; icon: string; label: string; badge?: string; exact?: boolean }) {
  const path = usePath();
  const done = useCloseOnPhone();
  const active = exact ? path === to : path === to || path.startsWith(to + "/");
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
  const path = usePath();
  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu aria-label={s?.title ?? "Library"} data-nav="library">
            <Item to={HOME} icon="library" label={s?.sourcesName ?? "Sources"} />
            <Item
              to={`${HOME}/updates`}
              icon="bell"
              label={s?.updatesName ?? "Updates"}
              badge={config?.newCount ? `${config.newCount} new` : undefined}
              exact={false}
            />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {config?.canManage && (
        <SidebarGroup>
          <SidebarGroupLabel>Manage · super admins</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Manage the library" data-nav="library-manage">
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={path === `${HOME}/manage` || /^\/a\/library\/manage\/(sources|updates)\//.test(path)}>
                  <Link to={`${HOME}/manage`}>
                    <Icon name="pencil" />
                    <span className="truncate">Items</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <Item to={`${HOME}/manage/settings`} icon="gear" label="Lists and settings" />
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
    { path: "/a/library", render: () => <SourcesPage /> },
    { path: "/a/library/updates", render: () => <UpdatesPage /> },
    { path: "/a/library/sources/:id", render: ({ id }) => <SourcePage id={id!} /> },
    { path: "/a/library/updates/:id", render: ({ id }) => <UpdatePage id={id!} /> },
    { path: "/a/library/manage", render: () => <ManagePage /> },
    { path: "/a/library/manage/settings", render: () => <SettingsPage /> },
    { path: "/a/library/manage/:kind/:id", render: ({ kind, id }) => <EditorPage kindPath={kind!} id={id!} /> }
  ],
  SidebarSection: LibrarySection
});
