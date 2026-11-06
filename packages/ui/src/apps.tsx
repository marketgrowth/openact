import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { AppConfig, CompanyDetail, User } from "@openact/core/shared";

/*
 * Client side of an OpenAct app.
 *
 * The shell owns sign-in, the side panel, the company switcher, company settings and the account menu.
 * An app adds pages, side panel items, commands and company settings tabs. The host lists the
 * installed apps, and createClient() builds the shell from them.
 */

export interface NavItem {
  label: string;
  /** A Lucide icon name from the Icon component, such as "projects" or "users". */
  icon: string;
  path: string;
  /** "main" shows the item near the top of the side panel. "footer" shows it near the bottom. */
  placement?: "main" | "footer";
}

export interface Command {
  id: string;
  label: string;
  icon: string;
  /** A letter. Ctrl or Cmd with this letter opens the command. */
  shortcut?: string;
  /** Shows the command at the top of the side panel. */
  inSidebar?: boolean;
  Dialog: ComponentType<{ onClose: () => void }>;
}

export interface CompanySettingsTab {
  id: string;
  label: string;
  Tab: ComponentType<{ detail: CompanyDetail & Record<string, unknown>; onChanged: () => Promise<void> }>;
}

export interface Route {
  /** Matched against the path. Capture groups go to render(). */
  pattern: RegExp;
  render: (match: RegExpMatchArray) => ReactNode;
}

export interface ClientApp {
  /** The same id as the app's server side. */
  id: string;
  name: string;
  /** Wraps the signed-in shell, for the app's own state, such as the current company's projects. */
  Provider?: ComponentType<{ children: ReactNode }>;
  /** The page at "/". The first app with a home page owns it. */
  Home?: ComponentType;
  routes?: Route[];
  /** Pages that work without sign-in, such as /colophon. */
  publicRoutes?: Record<string, ComponentType>;
  nav?: NavItem[];
  /** A block in the side panel, below the main items, such as a list of projects. */
  SidebarSection?: ComponentType;
  commands?: Command[];
  companySettingsTabs?: CompanySettingsTab[];
}

export function defineClientApp(app: ClientApp): ClientApp {
  return app;
}

/** What the shell shares with apps. */
export interface Shell {
  me: User | null;
  config: AppConfig;
  apps: readonly ClientApp[];
  /** Opens a shell dialog. */
  open: (dialog: "account" | "newCompany" | "companySettings") => void;
  /** Opens an app command, such as search. */
  runCommand: (id: string) => void;
}

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const s = useContext(ShellContext);
  if (!s) throw new Error("useShell needs the OpenAct shell.");
  return s;
}
