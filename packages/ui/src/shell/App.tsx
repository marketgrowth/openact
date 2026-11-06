import { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AppConfig, User } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Link, navigate, usePath } from "../router";
import { Field, Modal, ToastProvider, useToast } from "../ui";
import { WorkspaceProvider, useWorkspace } from "../workspace";
import { ShellContext, appHome, railApps, type ClientApp, type Shell } from "../apps";
import { SignIn } from "./SignIn";
import { AppSidebar } from "./Sidebar";
import { PageBody, SiteHeader } from "./SiteHeader";
import { SidebarInset, SidebarProvider } from "@openact/ui/components/sidebar";
import { TooltipProvider } from "@openact/ui/components/tooltip";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Separator } from "@openact/ui/components/separator";

// Loaded on first use, so the first page loads less code.
const CompanySettings = lazy(() => import("./CompanyDialogs").then((m) => ({ default: m.CompanySettings })));
const NewCompanyDialog = lazy(() => import("./CompanyDialogs").then((m) => ({ default: m.NewCompanyDialog })));

/** Starts the web app with the installed apps. The host's main.tsx calls it. */
export function createClient({ apps, root = document.getElementById("root")! }: { apps: ClientApp[]; root?: HTMLElement }) {
  createRoot(root).render(
    <StrictMode>
      <App apps={apps} />
    </StrictMode>
  );
}

export function App({ apps }: { apps: ClientApp[] }) {
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <Root apps={apps} />
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

const DEFAULT_CONFIG: AppConfig = { appName: "OpenAct", emailEnabled: true, signupMode: "open", aiProvider: "workers-ai", apps: [] };

function Root({ apps }: { apps: ClientApp[] }) {
  const path = usePath();
  const [me, setMe] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    api<{ user: User }>("/api/me")
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
    api<AppConfig>("/api/config")
      .then((c) => {
        setConfig(c);
        document.title = c.appName;
      })
      .catch(() => {});
  }, []);

  const noop = useCallback(() => {}, []);
  const publicShell = useMemo<Shell>(() => ({ me: me ?? null, config, apps, open: noop, runCommand: noop }), [me, config, apps, noop]);

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
      <SignedIn me={me} config={config} apps={apps} onMe={setMe} />
    </WorkspaceProvider>
  );
}

type Dialog = null | "account" | "newCompany" | "companySettings" | { command: string };

function SignedIn({ me, config, apps, onMe }: { me: User; config: AppConfig; apps: ClientApp[]; onMe: (u: User | null) => void }) {
  const path = usePath();
  const ws = useWorkspace();
  const [open, setOpen] = useState(readPanelOpen);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = useCallback(() => setDialog(null), []);
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

  const shell = useMemo<Shell>(() => ({ me, config, apps, open: (d) => setDialog(d), runCommand: (id) => setDialog({ command: id }) }), [me, config, apps]);

  // The page: the first app route that matches, or the first app's home page at "/".
  let page: ReactNode = null;
  for (const app of apps) {
    for (const r of app.routes ?? []) {
      const m = path.match(r.pattern);
      if (m) {
        page = onApps.includes(app) ? r.render(m) : <AppOff name={app.name} />;
        break;
      }
    }
    if (page) break;
  }
  if (!page && path === "/") {
    const Home = onApps.find((a) => a.Home)?.Home;
    const first = railApps(onApps)[0];
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
        onRunCommand={(id) => setDialog({ command: id })}
        onNewCompany={() => setDialog("newCompany")}
        onCompanySettings={() => setDialog("companySettings")}
        onAccount={() => setDialog("account")}
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
        {dialog === "account" && <AccountDialog me={me} onChange={onMe} onSignOut={signOut} onClose={close} />}
        {dialog === "newCompany" && <NewCompanyDialog onClose={close} />}
        {dialog === "companySettings" && ws.current && <CompanySettings companyId={ws.current.id} me={me} apps={onApps} onClose={close} />}
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
function AppOff({ name }: { name: string }) {
  return (
    <>
      <SiteHeader title={name || "No apps"} />
      <PageBody>
        <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-app-off="">
          <h2 className="text-lg font-semibold">{name ? `${name} is off for this company` : "No apps are on for this company"}</h2>
          <p className="text-sm text-muted-foreground">A company owner or admin can turn it on in Company settings, on the Apps tab.</p>
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

function AccountDialog({
  me,
  onChange,
  onSignOut,
  onClose
}: {
  me: User;
  onChange: (u: User | null) => void;
  onSignOut: (everywhere: boolean) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ user: User }>("/api/me", { method: "PATCH", body: { name } });
      onChange(r.user);
      toast("Your name is saved.");
      onClose();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Your account" description="Your name shows on tasks, comments and the people list." onClose={onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <Field label="Name" htmlFor="acc-name">
          <Input id="acc-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <div className="grid gap-2">
          <span className="text-sm leading-none font-medium">Email</span>
          <span className="font-mono text-sm text-muted-foreground">{me.email}</span>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !name.trim()}>
            Save name
          </Button>
        </div>
      </form>
      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => onSignOut(false)}>
          Sign out
        </Button>
        <Button type="button" variant="ghost" onClick={() => onSignOut(true)}>
          Sign out on all devices
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        <Link to="/colophon" onClick={onClose} className="underline underline-offset-4 hover:text-foreground">
          How OpenAct is made
        </Link>{" "}
        · Open source by MarketGrowth
      </p>
    </Modal>
  );
}
