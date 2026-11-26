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
import { SearchField } from "./SearchField";

/*
 * The Library in the web app. The side panel shows each group only to the people who can use it:
 * - Everyone: the search field, My Library and Company Library.
 * - Company owners (library.manage): Manage Company.
 * - Site owners (super admins): Manage Site Library, with the Content Vault and automations.
 * Every word readers see comes from the company's Library Settings, or the site's.
 */

const HomePage = lazy(() => import("./ReadPages").then((m) => ({ default: m.HomePage })));
const CategoriesPage = lazy(() => import("./ReadPages").then((m) => ({ default: m.CategoriesPage })));
const ResourcePage = lazy(() => import("./ReadPages").then((m) => ({ default: m.ResourcePage })));
const AskPage = lazy(() => import("./Ask").then((m) => ({ default: m.AskPage })));
const MinePage = lazy(() => import("./MinePages").then((m) => ({ default: m.MinePage })));
const MineAddPage = lazy(() => import("./MinePages").then((m) => ({ default: m.MineAddPage })));
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

function Group({ label, nav, children }: { label: string; nav: string; children: React.ReactNode }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu aria-label={label} data-nav={nav}>
          {children}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function LibrarySection() {
  const { config } = useLibrary();
  const done = useCloseOnPhone();
  const count = (n: number | undefined) => (n ? String(n) : undefined);
  const vaultTab = (t: string) => `${HOME}/vault?tab=${t}`;
  return (
    <>
      <div className="pt-2">
        <SearchField onDone={done} />
      </div>
      <Group label="My Library" nav="library-mine">
        <Item to={`${HOME}/mine`} icon="bookmark" label="Bookmarked" badge={count((config?.saved ?? 0) + (config?.added ?? 0))} />
        <Item to={`${HOME}/mine/add`} icon="plus" label="Add to My Library" />
      </Group>
      <Group label="Company Library" nav="library">
        <Item to={HOME} icon="library" label="All resources" match={(p) => p === HOME || p.startsWith(`${HOME}/r/`) || p.startsWith(`${HOME}/ask`)} />
        <Item to={`${HOME}/categories`} icon="grid" label="Categories" />
      </Group>
      {config?.canManage && (
        <Group label="Manage Company" nav="library-company">
          <Item to={`${HOME}/manage`} icon="folder" label="Company resources" match={(p) => p === `${HOME}/manage` || p.startsWith(`${HOME}/manage/r/`)} />
          <Item to={`${HOME}/manage/add`} icon="plus" label="Add resource" />
          <Item to={`${HOME}/manage/settings`} icon="gear" label="Library Settings" />
        </Group>
      )}
      {config?.isSiteOwner && (
        <Group label="Manage Site Library" nav="library-site">
          <Item to={vaultTab("published")} icon="archive" label="Content Vault" match={(p) => p === `${HOME}/vault` && !location.search.includes("tab=review")} />
          <Item to={`${HOME}/vault/add`} icon="plus" label="Add to Content Vault" />
          <Item to={vaultTab("review")} icon="inbox" label="To review" badge={count(config.toReview)} match={(p) => p === `${HOME}/vault` && location.search.includes("tab=review")} />
          <Item to={`${HOME}/vault/automations`} icon="plug" label="Automations" match={(p) => p.startsWith(`${HOME}/vault/automations`)} />
          <Item to={`${HOME}/vault/settings`} icon="gear" label="Site Library Settings" />
        </Group>
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
    { path: "/a/library/categories", render: () => <CategoriesPage /> },
    // A new question in the search field starts a new thread.
    { path: "/a/library/ask", render: () => <AskPage key={location.search} /> },
    { path: "/a/library/r/:id", render: ({ id }) => <ResourcePage id={id!} /> },
    { path: "/a/library/mine", render: () => <MinePage /> },
    { path: "/a/library/mine/add", render: () => <MineAddPage /> },
    { path: "/a/library/manage", render: () => <ManagePage level="company" key="company" /> },
    { path: "/a/library/manage/add", render: () => <AddPage level="company" key="company" /> },
    { path: "/a/library/manage/r/:id", render: ({ id }) => <EditPage id={id!} level="company" /> },
    { path: "/a/library/manage/settings", render: () => <SettingsPage level="company" key="company" /> },
    { path: "/a/library/vault", render: () => <ManagePage level="site" key={`site${location.search}`} /> },
    { path: "/a/library/vault/add", render: () => <AddPage level="site" key="site" /> },
    { path: "/a/library/vault/r/:id", render: ({ id }) => <EditPage id={id!} level="site" /> },
    { path: "/a/library/vault/automations", render: () => <AutomationsPage /> },
    { path: "/a/library/vault/automations/new", render: () => <NewAutomationPage /> },
    { path: "/a/library/vault/settings", render: () => <SettingsPage level="site" key="site" /> }
  ],
  SidebarSection: LibrarySection
});
