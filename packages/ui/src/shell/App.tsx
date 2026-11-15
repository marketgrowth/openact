import { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AppConfig, SiteSettings, User } from "@openact/core/shared";
import { api } from "../api";
import { Link, navigate, usePath } from "../router";
import { ToastProvider } from "../ui";
import { WorkspaceProvider, useWorkspace } from "../workspace";
import { settingsPath } from "../settings-paths";
import { APPS_PATH, ShellContext, appHome, isSettingsPath, railOrder, type ClientApp, type DirectoryApp, type Shell } from "../apps";
import { SignIn } from "./SignIn";
import { PLAN_PATH, PlanPage } from "./Plan";
import { AppSidebar } from "./Sidebar";
import { PageBody, SiteHeader } from "./SiteHeader";
import { SidebarInset, SidebarProvider } from "@openact/ui/components/sidebar";
import { TooltipProvider } from "@openact/ui/components/tooltip";
import { Button } from "@openact/ui/components/button";

// Loaded on first use, so the first page loads less code.
const SettingsPage = lazy(() => import("./SettingsPage").then((m) => ({ default: m.SettingsPage })));
const NewCompanyDialog = lazy(() => import("./CompanyDialogs").then((m) => ({ default: m.NewCompanyDialog })));
const AppsPage = lazy(() => import("./AppsPage").then((m) => ({ default: m.AppsPage })));

/**
 * Starts the web app with the installed apps. The host's main.tsx calls it.
 * Pass `directory` (the apps from directory/apps.json) to list apps that a company can add on the Apps page.
 * Pass `primary` (the id from "primary" in openact.apps.json) to put that app at the top of the app rail, above a divider.
 */
export function createClient({
  apps,
  directory = [],
  primary = null,
  root = document.getElementById("root")!
}: {
  apps: ClientApp[];
  directory?: readonly DirectoryApp[];
  primary?: string | null;
  root?: HTMLElement;
}) {
  createRoot(root).render(
    <StrictMode>
      <App apps={apps} directory={directory} primary={primary} />
    </StrictMode>
  );
}

export function App({ apps, directory = [], primary = null }: { apps: ClientApp[]; directory?: readonly DirectoryApp[]; primary?: string | null }) {
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <Root apps={apps} directory={directory} primary={primary} />
      </ToastProvider>
    </TooltipProvider>
  );
}

const PANEL_KEY = "openact-sidepanel";

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

// The sign-in heading stays empty until /api/config loads, so a custom heading does not flash the default first.
const DEFAULT_CONFIG: AppConfig = {
  appName: "OpenAct",
  logoUrl: null,
  emailEnabled: true,
  signupMode: "open",
  aiProvider: "workers-ai",
  apps: [],
  signIn: { heading: "", credit: "", termsUrl: null, privacyUrl: null, backgroundUrl: null }
};

function Root({ apps, directory, primary }: { apps: ClientApp[]; directory: readonly DirectoryApp[]; primary: string | null }) {
  const path = usePath();
  const [me, setMe] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    api<{ user: User }>("/api/me")
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
    api<AppConfig>("/api/config")
      .then(setConfig)
      .catch(() => {});
  }, []);

  // The browser tab follows the site settings.
  useEffect(() => {
    document.title = config.appName;
    setFavicon(config.logoUrl);
  }, [config.appName, config.logoUrl]);

  const onSite = useCallback(
    (s: SiteSettings) =>
      setConfig((c) => {
        const { customHeading: _, ...signIn } = s.signIn;
        return { ...c, appName: s.appName, logoUrl: s.logoUrl, signIn };
      }),
    []
  );

  const noop = useCallback(() => {}, []);
  const publicShell = useMemo<Shell>(
    () => ({ me: me ?? null, config, apps, primary, directory, open: noop, runCommand: noop }),
    [me, config, apps, primary, directory, noop]
  );

  // Pages that work without sign-in, such as the colophon.
  for (const app of apps) {
    const Page = app.publicRoutes?.[path];
    if (Page)
      return (
        <ShellContext.Provider value={publicShell}>
          <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
            <Page />
          </Suspense>
        </ShellContext.Provider>
      );
  }
  if (me === undefined) return <div className="min-h-dvh bg-background" aria-busy="true" />;
  if (!me) return <SignIn config={config} onSignedIn={setMe} />;
  return (
    <WorkspaceProvider key={me.id}>
      <SignedIn me={me} config={config} apps={apps} primary={primary} directory={directory} onMe={setMe} onSite={onSite} />
    </WorkspaceProvider>
  );
}

type Dialog = null | "newCompany" | { command: string };

/** Shows the site logo as the tab icon, or the default icon from index.html. */
function setFavicon(url: string | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) return;
  if (link.dataset.defaultHref === undefined) {
    link.dataset.defaultHref = link.getAttribute("href") ?? "";
    link.dataset.defaultType = link.getAttribute("type") ?? "";
  }
  link.href = url ?? link.dataset.defaultHref;
  if (url) link.removeAttribute("type");
  else if (link.dataset.defaultType) link.type = link.dataset.defaultType;
}

function SignedIn({
  me,
  config,
  apps,
  primary,
  directory,
  onMe,
  onSite
}: {
  me: User;
  config: AppConfig;
  apps: ClientApp[];
  primary: string | null;
  directory: readonly DirectoryApp[];
  onMe: (u: User | null) => void;
  onSite: (s: SiteSettings) => void;
}) {
  const path = usePath();
  const ws = useWorkspace();
  const [open, setOpen] = useState(readPanelOpen);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = useCallback(() => setDialog(null), []);
  // Super admins see Site settings on the Settings page. The server checks again on every change. undefined while it loads.
  const [superAdmin, setSuperAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    api<SiteSettings>("/api/site")
      .then((s) => setSuperAdmin(s.canEdit))
      .catch(() => setSuperAdmin(false));
  }, [me.id]);
  // Apps that are off in this company leave the rail, the commands and the routes.
  const disabled = ws.access?.disabledApps ?? [];
  const disabledKey = disabled.join(",");
  const onApps = useMemo(() => apps.filter((a) => !disabled.includes(a.id)), [apps, disabledKey]);
  const commands = useMemo(() => onApps.flatMap((a) => a.commands ?? []), [onApps]);

  // Ctrl or Cmd with a command's letter opens it from anywhere. Ctrl+B or Cmd+B (in the sidebar) toggles the side panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const cmd = commands.find((c) => c.shortcut && c.shortcut.toLowerCase() === e.key.toLowerCase());
      if (!cmd) return;
      e.preventDefault();
      setDialog((d) => (d && typeof d === "object" && d.command === cmd.id ? null : { command: cmd.id }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commands]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(PANEL_KEY, next ? "open" : "collapsed");
    } catch {
      /* Storage can be blocked. The panel still works. */
    }
  };

  const signOut = useCallback(
    async (everywhere: boolean) => {
      await api(everywhere ? "/api/me/sign-out-everywhere" : "/api/auth/logout", { method: "POST" }).catch(() => {});
      onMe(null);
      navigate("/", true);
    },
    [onMe]
  );

  const shell = useMemo<Shell>(
    () => ({
      me,
      config,
      apps,
      primary,
      directory,
      // Company settings and the account are pages now. Apps that still ask for the dialogs go to the pages.
      open: (d) =>
        d === "companySettings" ? navigate(settingsPath("company", "general")) : d === "account" ? navigate(settingsPath("account", "profile")) : setDialog(d),
      runCommand: (id) => setDialog({ command: id })
    }),
    [me, config, apps, primary, directory]
  );

  // The page: the first app route that matches, or the first app's home page at "/".
  let page: ReactNode =
    path === APPS_PATH ? (
      <AppsPage />
    ) : path === PLAN_PATH ? (
      <PlanPage />
    ) : isSettingsPath(path) ? (
      <SettingsPage me={me} apps={onApps} onSite={onSite} onMe={onMe} onSignOut={signOut} />
    ) : null;
  for (const app of page ? [] : apps) {
    for (const r of app.routes ?? []) {
      const m = path.match(r.pattern);
      if (m) {
        page = onApps.includes(app) ? r.render(m) : <AppOff name={app.name} locked={!!ws.access?.lockedApps.includes(app.id)} />;
        break;
      }
    }
    if (page) break;
  }
  if (!page && path === "/") {
    const Home = onApps.find((a) => a.Home)?.Home;
    const first = railOrder(onApps, primary)[0];
    if (Home) page = <Home />;
    else if (first && ws.access) page = <Redirect to={appHome(first, onApps)} />;
    else if (ws.access) page = <AppOff name="" />;
  }
  if (!page) page = ws.access || path !== "/" ? <NotFound /> : null;

  const activeCommand = dialog && typeof dialog === "object" ? commands.find((c) => c.id === dialog.command) : undefined;

  // App providers wrap the shell, in install order.
  let body: ReactNode = (
    <SidebarProvider open={open} onOpenChange={onOpenChange} style={{ "--header-height": "calc(var(--spacing) * 12)", "--sidebar-width": "19rem" } as CSSProperties}>
      <AppSidebar
        me={me}
        appName={config.appName}
        apps={onApps}
        primary={primary}
        onRunCommand={(id) => setDialog({ command: id })}
        onNewCompany={() => setDialog("newCompany")}
        superAdmin={superAdmin === true}
        onSignOut={signOut}
      />
      <SidebarInset className="min-w-0">
        <Suspense
          fallback={
            <PageBody>
              <p className="text-sm text-muted-foreground">Loading…</p>
            </PageBody>
          }
        >
          {page}
        </Suspense>
      </SidebarInset>
      <Suspense fallback={null}>
        {dialog === "newCompany" && <NewCompanyDialog onClose={close} />}
        {activeCommand && <activeCommand.Dialog onClose={close} />}
      </Suspense>
    </SidebarProvider>
  );
  for (const app of [...apps].reverse()) if (app.Provider) body = <app.Provider>{body}</app.Provider>;
  return <ShellContext.Provider value={shell}>{body}</ShellContext.Provider>;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

/** An app that is off in this company. An empty name means that every app is off. */
function AppOff({ name, locked = false }: { name: string; locked?: boolean }) {
  if (locked)
    return (
      <>
        <SiteHeader title={name} />
        <PageBody>
          <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-app-locked="">
            <h2 className="text-lg font-semibold">{name} is part of OpenAct Director</h2>
            <p className="text-sm text-muted-foreground">A company owner can upgrade on the Plan page. Your data in {name} stays while it is locked.</p>
            <Button asChild>
              <Link to={PLAN_PATH}>See plans</Link>
            </Button>
          </div>
        </PageBody>
      </>
    );
  return (
    <>
      <SiteHeader title={name || "No apps"} />
      <PageBody>
        <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-app-off="">
          <h2 className="text-lg font-semibold">{name ? `${name} is off for this company` : "No apps are on for this company"}</h2>
          <p className="text-sm text-muted-foreground">A company owner or admin can turn it on in Company settings, under Apps.</p>
        </div>
      </PageBody>
    </>
  );
}

function NotFound() {
  return (
    <>
      <SiteHeader title="Not found" />
      <PageBody>
        <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">This page does not exist</h2>
          <p className="text-sm text-muted-foreground">Check the address, or go back to the start.</p>
          <Button asChild>
            <Link to="/">Go to the start</Link>
          </Button>
        </div>
      </PageBody>
    </>
  );
}
