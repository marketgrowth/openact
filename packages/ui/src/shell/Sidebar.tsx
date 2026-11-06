import { COMPANY_ROLE_LABELS, type Company, type User } from "@openact/core/shared";
import type { ClientApp } from "../apps";
import { canManageCompany } from "@openact/core/shared";
import { Link, usePath } from "../router";
import { Avatar, Icon } from "../ui";
import { useWorkspace } from "../workspace";
import { getTheme, setTheme, type ThemePref } from "../theme";
import { useState } from "react";
import { cn } from "@openact/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@openact/ui/components/dropdown-menu";
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
} from "@openact/ui/components/sidebar";
import { Kbd } from "@openact/ui/components/kbd";

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
  apps: readonly ClientApp[];
  onRunCommand: (id: string) => void;
  onNewCompany: () => void;
  onCompanySettings: () => void;
  onAccount: () => void;
  onSignOut: (everywhere: boolean) => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Closes the side panel on a phone after the person picks a place to go. */
export function useCloseOnPhone(): () => void {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

/** The left side panel: the company switcher, the apps' items, and the person's menu. */
export function AppSidebar(p: AppSidebarProps) {
  const ws = useWorkspace();
  const path = usePath();
  const done = useCloseOnPhone();
  const current = ws.current;
  const canManage = canManageCompany(current?.role ?? null);
  const commands = current ? p.apps.flatMap((a) => (a.commands ?? []).filter((c) => c.inSidebar)) : [];
  const nav = p.apps.flatMap((a) => a.nav ?? []);
  const main = nav.filter((n) => (n.placement ?? "main") === "main");
  const footer = nav.filter((n) => n.placement === "footer");

  return (
    <Sidebar variant="inset" collapsible="icon" aria-label="Main">
      <SidebarHeader>
        <CompanySwitcher appName={p.appName} onNewCompany={p.onNewCompany} onCompanySettings={p.onCompanySettings} onPick={done} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {commands.map((cmd) => (
                <SidebarMenuItem key={cmd.id}>
                  <SidebarMenuButton
                    tooltip={cmd.label}
                    onClick={() => p.onRunCommand(cmd.id)}
                    aria-keyshortcuts={cmd.shortcut ? `Control+${cmd.shortcut.toUpperCase()} Meta+${cmd.shortcut.toUpperCase()}` : undefined}
                  >
                    <Icon name={cmd.icon} />
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">
                        {isMac ? `⌘${cmd.shortcut.toUpperCase()}` : `Ctrl ${cmd.shortcut.toUpperCase()}`}
                      </Kbd>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {main.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild tooltip={item.label} isActive={path === item.path}>
                    <Link to={item.path} onClick={done}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {current && p.apps.map((a) => a.SidebarSection && <a.SidebarSection key={a.id} />)}

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
              {footer.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild tooltip={item.label} size="sm" isActive={path === item.path}>
                    <Link to={item.path} onClick={done}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
