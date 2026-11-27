import { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AppConfig, SiteSettings, User } from "@openact/core/shared";
import { api } from "../api";
import { Link, Redirect, RouteParamsContext, navigate, usePath } from "../router";
import { Logo, ToastProvider } from "../ui";
import { WorkspaceProvider, useWorkspace } from "../workspace";
import { settingsPath } from "../settings-paths";
import { iconLinks, setFavicon } from "../favicon";
import { APPS_PATH, ShellContext, appHome, appOwnsPath, guardApps, homeAppAt, isSettingsPath, matchRoute, railOrder, type ClientApp, type DirectoryApp, type Route, type Shell } from "../apps";
import { SignIn } from "./SignIn";
import { PLAN_PATH } from "./Plan";
import { AppSidebar } from "./Sidebar";
import { PageBody, SiteHeader } from "./SiteHeader";
import { SidebarInset, SidebarProvider } from "@openact/ui/components/sidebar";
import { TooltipProvider } from "@openact/ui/components/tooltip";
import { Button } from "@openact/ui/components/button";

// Loaded on first use, so the first page loads less code.
const SettingsPage = lazy(() => import("./SettingsPage").then((m) => ({ default: m.SettingsPage })));
const Onboarding = lazy(() => import("./Onboarding").then((m) => ({ default: m.Onboarding })));
const NewCompanyDialog = lazy(() => import("./CompanyDialogs").then((m) => ({ default: m.NewCompanyDialog })));
const AppsPage = lazy(() => import("./AppsPage").then((m) => ({ default: m.AppsPage })));
const AgentConsent = lazy(() => import("./AgentConsent").then((m) => ({ default: m.AgentConsent })));

/** The consent page that AI agents send people to. Same path as CONSENT_PATH in AgentConsent.tsx. */
const CONSENT_PATH = "/oauth/authorize";

/**
 * Starts the web app with the installed apps. The host's main.tsx calls it.
 * Pass `directory` (the apps from directory/apps.json) to list apps that a company can add on the Apps page.
 * Pass `primary` (the id from "primary" in openact.apps.json) to put that app at the top of the app rail, above a divider.
 * Pass `systemIds` (from directory/apps.json) so the host's own apps, such as "site", keep their short paths.
 * Official apps (ids reserved in the directory), the primary app and system apps can use any path.
 * Every other app stays under /a/<id>/. Read guardApps in app-paths.ts.
 */
export function createClient({
  apps,
  directory = [],
  primary = null,
  systemIds = [],
  root = document.getElementById("root")!
}: {
  apps: ClientApp[];
  directory?: readonly DirectoryApp[];
  primary?: string | null;
  systemIds?: readonly string[];
  root?: HTMLElement;
}) {
  createRoot(root).render(
    <StrictMode>
      <App apps={apps} directory={directory} primary={primary} systemIds={systemIds} />
    </StrictMode>
  );
}

export function App({
  apps,
  directory = [],
  primary = null,
  systemIds = []
}: {
  apps: ClientApp[];
  directory?: readonly DirectoryApp[];
  primary?: string | null;
  systemIds?: readonly string[];
}) {
  // Community apps stay in their own space, /a/<id>/, so they cannot take another app's pages.
  const guarded = useMemo(() => guardApps(apps, { directory, systemIds, primary }), [apps, directory, systemIds, primary]);
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <Root apps={guarded} directory={directory} primary={primary} />
      </ToastProvider>
    </TooltipProvider>
  );
}

/** Renders a route's page with its params, so the page can call useParams(). */
function renderRoute(r: Route, found: NonNullable<ReturnType<typeof matchRoute>>): ReactNode {
  return <RouteParamsContext.Provider value={found.params}>{r.path !== undefined ? r.render(found.params) : r.render(found.match)}</RouteParamsContext.Provider>;
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
  issuesUrl: null,
  emailEnabled: true,
  signupMode: "open",
  aiProvider: "workers-ai",
  apps: [],
  signIn: { heading: "", credit: "", termsUrl: null, privacyUrl: null, backgroundUrl: null },
  agentAccess: false
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
    setFavicon(config.logoUrl, iconLinks(document));
  }, [config.appName, config.logoUrl]);

  const onSite = useCallback(
    (s: SiteSettings) =>
      setConfig((c) => {
        const { customHeading: _, ...signIn } = s.signIn;
        return { ...c, appName: s.appName, logoUrl: s.logoUrl, issuesUrl: s.issuesUrl, signIn };
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
  // A paused partner host shows only the paused page. Its API answers nothing else (docs/partners.md).
  if (config.partner?.paused) return <PausedHost config={config} />;
  if (me === undefined) return <div className="min-h-dvh bg-background" aria-busy="true" />;
  if (!me) return <SignIn config={config} onSignedIn={setMe} />;
  // An AI agent asks to connect. The person signs in first, then answers on this page.
  if (path === CONSENT_PATH)
    return (
      <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
        <AgentConsent config={config} />
      </Suspense>
    );
  return (
    <WorkspaceProvider key={me.id}>
      <SignedIn me={me} config={config} apps={apps} primary={primary} directory={directory} onMe={setMe} onSite={onSite} />
    </WorkspaceProvider>
  );
}

type Dialog = null | "newCompany" | { command: string };

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
  // Super admins see Site settings on the Settings page and the App directory. The server checks again on every change. undefined while it loads.
  const [superAdmin, setSuperAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    api<SiteSettings>("/api/site")
      .then((s) => setSuperAdmin(s.canEdit))
      .catch(() => setSuperAdmin(false));
  }, [me.id]);
  // A new person with no company sets one up first (docs/onboarding.md). undefined while it loads.
  const [onboarding, setOnboarding] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (ws.companies === null) return;
    if (ws.companies.length > 0) return setOnboarding(false);
    api<{ required: boolean }>("/api/onboarding")
      .then((r) => setOnboarding(r.required))
      .catch(() => setOnboarding(false));
  }, [ws.companies]);
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

  // An app with collapsePanel, such as the CMS app, closes the panel on its pages. The saved choice stays as it is.
  const collapsed = useMemo(
    () => path !== APPS_PATH && !isSettingsPath(path) && onApps.some((a) => a.collapsePanel && appOwnsPath(a, onApps, path)),
    [onApps, path]
  );
  // On those pages, Ctrl+B or Cmd+B opens the panel for now only.
  const [peek, setPeek] = useState(false);
  useEffect(() => setPeek(false), [collapsed]);
  const panelOpen = collapsed ? peek : open;

  const onOpenChange = (next: boolean) => {
    if (collapsed) {
      setPeek(next);
      return;
    }
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

  if (onboarding && ws.companies?.length === 0)
    return (
      <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
        <Onboarding appName={config.appName} logoUrl={config.logoUrl} email={me.email} />
      </Suspense>
    );

  // The page: the first app route that matches, or the first app's home page at "/".
  let page: ReactNode =
    path === APPS_PATH ? (
      // Only super admins, the owners of the brand, see the App directory. Others go to the home page.
      superAdmin === true ? (
        <AppsPage />
      ) : superAdmin === false ? (
        <Redirect to="/" />
      ) : (
        <PageBody>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </PageBody>
      )
    ) : path === "/plan" ? (
      // The old Plan page. Plans are in Site settings now.
      superAdmin === undefined ? (
        <PageBody>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </PageBody>
      ) : (
        <Redirect to={superAdmin ? PLAN_PATH : "/"} />
      )
    ) : isSettingsPath(path) ? (
      <SettingsPage me={me} apps={onApps} superAdmin={superAdmin} onSite={onSite} onMe={onMe} onSignOut={signOut} />
    ) : null;
  for (const app of page ? [] : apps) {
    for (const r of app.routes ?? []) {
      const m = matchRoute(r, path);
      if (m) {
        page = onApps.includes(app) ? renderRoute(r, m) : <AppOff name={app.name} locked={!!ws.access?.lockedApps.includes(app.id)} blocked={!!ws.access?.blockedApps?.includes(app.id)} superAdmin={superAdmin === true} />;
        break;
      }
    }
    if (page) break;
  }
  // An app's own path, /a/<id>, shows its home page. When the app owns "/", it goes there instead.
  const homeApp = page ? undefined : homeAppAt(apps, path);
  if (homeApp && homeApp.Home) {
    const HomeAt = homeApp.Home;
    if (!onApps.includes(homeApp)) page = <AppOff name={homeApp.name} locked={!!ws.access?.lockedApps.includes(homeApp.id)} blocked={!!ws.access?.blockedApps?.includes(homeApp.id)} superAdmin={superAdmin === true} />;
    else if (appHome(homeApp, onApps) === "/") page = <Redirect to="/" />;
    else page = <HomeAt />;
  }
  if (!page && path === "/") {
    const Home = onApps.find((a) => a.Home)?.Home;
    const first = railOrder(onApps, primary)[0];
    if (Home) page = <Home />;
    else if (first && ws.access) page = <Redirect to={appHome(first, onApps)} />;
    else if (ws.access) page = <AppOff name="" />;
  }
  if (!page) page = ws.access || path !== "/" ? <NotFound /> : null;
  // While the company's partner is paused, every app is off. Settings still open, so people can switch companies.
  if (ws.access?.pausedBy && !isSettingsPath(path)) page = <Paused name={ws.access.pausedBy} />;

  const activeCommand = dialog && typeof dialog === "object" ? commands.find((c) => c.id === dialog.command) : undefined;

  // App providers wrap the shell, in install order.
  let body: ReactNode = (
    <SidebarProvider open={panelOpen} onOpenChange={onOpenChange} style={{ "--header-height": "calc(var(--spacing) * 12)", "--sidebar-width": "19rem" } as CSSProperties}>
      <AppSidebar
        me={me}
        appName={config.appName}
        issuesUrl={config.issuesUrl}
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

/** An app that is off in this company. An empty name means that every app is off. */
function AppOff({ name, locked = false, blocked = false, superAdmin = false }: { name: string; locked?: boolean; blocked?: boolean; superAdmin?: boolean }) {
  if (blocked)
    return (
      <>
        <SiteHeader title={name} />
        <PageBody>
          <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-app-blocked="">
            <h2 className="text-lg font-semibold">{name} is not available for this company</h2>
            <p className="text-sm text-muted-foreground">
              {superAdmin ? "Make it available in Site settings, under Apps." : "Ask the owner of this site to make it available."} Your data in {name} stays.
            </p>
            {superAdmin && (
              <Button asChild>
                <Link to={settingsPath("site", "apps")}>Open Site settings</Link>
              </Button>
            )}
          </div>
        </PageBody>
      </>
    );
  if (locked)
    return (
      <>
        <SiteHeader title={name} />
        <PageBody>
          <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-app-locked="">
            <h2 className="text-lg font-semibold">{name} is part of a paid plan</h2>
            <p className="text-sm text-muted-foreground">
              {superAdmin ? "Choose a plan in Site settings." : "Ask the owner of this site to upgrade the plan."} Your data in {name} stays while it
              is locked.
            </p>
            {superAdmin && (
              <Button asChild>
                <Link to={PLAN_PATH}>See plans</Link>
              </Button>
            )}
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

/** The text for a paused partner, in the app and on the partner's host. */
function pausedText(name: string) {
  return `The service is paused for ${name} and its clients. Your data is safe, and it comes back when the service starts again. Ask ${name} about your account.`;
}

function Paused({ name }: { name: string }) {
  return (
    <>
      <SiteHeader title="Paused" />
      <PageBody>
        <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-partner-paused="">
          <h2 className="text-lg font-semibold">This service is paused</h2>
          <p className="text-sm text-muted-foreground">{pausedText(name)}</p>
          <p className="text-sm text-muted-foreground">To use another company, switch companies in the side panel.</p>
        </div>
      </PageBody>
    </>
  );
}

/** The whole page on a paused partner host. */
function PausedHost({ config }: { config: AppConfig }) {
  const name = config.partner?.name ?? config.appName;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4" data-partner-paused="">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center text-card-foreground">
        <Logo size={40} src={config.logoUrl} />
        <h1 className="text-xl font-semibold">{name} is paused</h1>
        <p className="text-sm text-muted-foreground">{pausedText(name)}</p>
      </div>
    </main>
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
