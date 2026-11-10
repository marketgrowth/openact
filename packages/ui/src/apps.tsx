import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { AppConfig, CompanyDetail, PaidPlan, User } from "@openact/core/shared";

/*
 * Client side of an OpenAct app.
 *
 * The shell owns sign-in, the side panel, the company switcher, company settings and the account menu.
 * An app adds pages, side panel items, commands and company settings tabs. The host lists the
 * installed apps, and createClient() builds the shell from them.
 */

export { APPS_PATH, activeApp, appHome, appOwnsPath, railApps } from "./app-paths.ts";

export interface NavItem {
  label: string;
  /** A Lucide icon name from the Icon component, such as "projects" or "users". */
  icon: string;
  path: string;
  /**
   * "main" shows the item at the top of the app's panel, when the app is active.
   * "footer" shows it as an icon at the bottom of the app rail, for every app.
   */
  placement?: "main" | "footer";
}

export interface Command {
  id: string;
  label: string;
  icon: string;
  /** A letter. Ctrl or Cmd with this letter opens the command. */
  shortcut?: string;
  /** Shows the command at the top of the app's panel, when the app is active. */
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
  /**
   * The app's icon in the app rail, as a Lucide name for Icon, such as "projects".
   * Apps with an icon or a Mark show in the rail. Apps without one, such as the colophon, do not.
   */
  icon?: string;
  /** A custom icon for the app rail, such as a brand mark. Draw it with currentColor at 16 by 16. */
  Mark?: ComponentType<{ className?: string }>;
  /** Where the rail icon goes. Default: "/" for the first app with a home page, otherwise /a/<id>. */
  home?: string;
  /**
   * True when a path belongs to this app, so the rail lights it and the panel shows its items.
   * Default: the home path, paths under /a/<id>/, and the app's routes.
   */
  ownsPath?: (path: string) => boolean;
  /** Wraps the signed-in shell, for the app's own state, such as the current company's projects. */
  Provider?: ComponentType<{ children: ReactNode }>;
  /** The page at "/". The first app with a home page owns it. */
  Home?: ComponentType;
  routes?: Route[];
  /** Pages that work without sign-in, such as /colophon. */
  publicRoutes?: Record<string, ComponentType>;
  nav?: NavItem[];
  /** Groups in the app's panel, below the main items, such as pinned and recent projects. Shows when the app is active. */
  SidebarSection?: ComponentType;
  commands?: Command[];
  companySettingsTabs?: CompanySettingsTab[];
}

export function defineClientApp(app: ClientApp): ClientApp {
  return app;
}

/** What the shell shares with apps. */
/** One entry of the app directory, from directory/apps.json. */
export interface DirectoryApp {
  id: string;
  name: string;
  summary: string;
  category: string;
  status: "built-in" | "available" | "planned" | "example";
  publisher: string;
  repo: string;
  /** The plan the app needs, such as "director". Missing: the app is free. */
  plan?: PaidPlan;
}

export interface Shell {
  me: User | null;
  config: AppConfig;
  apps: readonly ClientApp[];
  /** The app directory, for the Apps page. Empty when the host does not pass it. */
  directory: readonly DirectoryApp[];
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
