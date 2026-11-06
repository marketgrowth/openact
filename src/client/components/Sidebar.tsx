import { COMPANY_ROLE_LABELS, type Company, type User } from "../../shared/types";
import { canCreateProjects, canManageCompany } from "../../shared/access";
import { Link, usePath } from "../router";
import { Avatar, Icon } from "../ui";
import { useWorkspace } from "../workspace";
import { getTheme, setTheme, type ThemePref } from "../theme";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from "@/components/ui/sidebar";
import { Kbd } from "@/components/ui/kbd";

/** A company's logo, or its initials on a square. */
export function CompanyMark({ company, size = 32, className }: { company: Pick<Company, "id" | "name" | "logoUrl">; size?: number; className?: string }) {
  if (company.logoUrl)
    return (
      <img
        className={cn("shrink-0 rounded-lg object-cover", className)}
        src={company.logoUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        data-company-mark=""
      />
    );
  const initials =
    company.name
      .split(/\s+/)
      .filter((w) => /[a-z0-9]/i.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-lg bg-sidebar-primary font-semibold text-sidebar-primary-foreground", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
      data-company-mark=""
    >
      {initials}
    </span>
  );
}

export interface AppSidebarProps {
  me: User;
  appName: string;
  onNewProject: () => void;
  onNewCompany: () => void;
  onCompanySettings: () => void;
  onAccount: () => void;
  onSearch: () => void;
  onSignOut: (everywhere: boolean) => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The left side panel: the company switcher, the company's projects, and the person's menu. */
export function AppSidebar(p: AppSidebarProps) {
  const ws = useWorkspace();
  const path = usePath();
  const { isMobile, setOpenMobile } = useSidebar();
  const current = ws.current;
  const canCreate = canCreateProjects(current?.role ?? null);
  const canManage = canManageCompany(current?.role ?? null);
  // On a phone, close the sheet after the person picks a place to go.
  const done = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar variant="inset" collapsible="icon" aria-label="Main">
      <SidebarHeader>
        <CompanySwitcher appName={p.appName} onNewCompany={p.onNewCompany} onCompanySettings={p.onCompanySettings} onPick={done} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {current && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Search" onClick={p.onSearch} aria-keyshortcuts="Control+K Meta+K">
                    <Icon name="search" />
                    <span>Search</span>
                    <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="All projects" isActive={path === "/"}>
                  <Link to="/" onClick={done}>
                    <Icon name="projects" />
                    <span>All projects</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {current && (
          <Collapsible defaultOpen className="group/collapsible">
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger>
                  Projects
                  <Icon name="chevron" size={14} className="ml-1 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              {canCreate && (
                <SidebarGroupAction title="New project" onClick={p.onNewProject}>
                  <Icon name="plus" />
                  <span className="sr-only">New project</span>
                </SidebarGroupAction>
              )}
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu aria-label="Projects" data-nav="projects">
                    {ws.projects === null && <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Loading…</p>}
                    {ws.projects?.map((proj) => {
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
                    {ws.projects && !ws.projects.length && (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">No projects yet.</p>
                    )}
                    {canCreate && (
                      <SidebarMenuItem>
                        <SidebarMenuButton tooltip="New project" onClick={p.onNewProject} className="text-muted-foreground">
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
        )}

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {canManage && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Company settings" onClick={p.onCompanySettings} size="sm">
                    <Icon name="gear" />
                    <span>Company settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Colophon" size="sm" isActive={path === "/colophon"}>
                  <Link to="/colophon" onClick={done}>
                    <Icon name="doc" />
                    <span>Colophon</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser me={p.me} onAccount={p.onAccount} onSignOut={p.onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function CompanySwitcher({
  appName,
  onNewCompany,
  onCompanySettings,
  onPick
}: {
  appName: string;
  onNewCompany: () => void;
  onCompanySettings: () => void;
  onPick: () => void;
}) {
  const ws = useWorkspace();
  const { isMobile } = useSidebar();
  const current = ws.current;

  const pick = async (id: string) => {
    onPick();
    if (id !== current?.id) await ws.switchTo(id);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              aria-label={current ? `Company: ${current.name}. Change company` : "Choose a company"}
              data-company-switch=""
            >
              {current ? (
                <CompanyMark company={current} />
              ) : (
                <span className="flex size-8 items-center justify-center rounded-lg border border-dashed">
                  <Icon name="plus" />
                </span>
              )}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold" data-company-name="">
                  {current?.name ?? "No company yet"}
                </span>
                <span className="truncate text-xs text-muted-foreground">{appName}</span>
              </div>
              <Icon name="updown" className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Your companies</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={current?.id ?? ""} onValueChange={pick}>
              {(ws.companies ?? []).map((co) => (
                <DropdownMenuRadioItem key={co.id} value={co.id} className="gap-2 py-1.5">
                  <CompanyMark company={co} size={24} className="rounded-md" />
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate">{co.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{COMPANY_ROLE_LABELS[co.role]}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {current && canManageCompany(current.role) && (
              <DropdownMenuItem onSelect={onCompanySettings}>
                <Icon name="gear" /> Company settings
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onNewCompany}>
              <Icon name="plus" /> Create a company
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavUser({ me, onAccount, onSignOut }: { me: User; onAccount: () => void; onSignOut: (everywhere: boolean) => void }) {
  const { isMobile } = useSidebar();
  const [theme, setPref] = useState<ThemePref>(getTheme);
  const name = me.name || me.email;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              aria-label="Your account"
              data-account=""
            >
              <Avatar id={me.id} name={name} size={32} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{me.email}</span>
              </div>
              <Icon name="updown" className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar id={me.id} name={name} size={32} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs text-muted-foreground">{me.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAccount}>
              <Icon name="users" /> Account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(v) => {
                setTheme(v as ThemePref);
                setPref(v as ThemePref);
              }}
            >
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSignOut(false)}>
              <Icon name="out" /> Sign out
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSignOut(true)}>
              <Icon name="out" /> Sign out on all devices
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
