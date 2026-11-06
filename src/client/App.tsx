import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import type { AppConfig, User } from "../shared/types";
import { api, errorText } from "./api";
import { Link, navigate, usePath } from "./router";
import { Modal, ToastProvider, useToast, Field } from "./ui";
import { SignIn } from "./pages/SignIn";
import { NewProjectDialog, ProjectsPage } from "./pages/Projects";
import { AppSidebar } from "./components/Sidebar";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { ProjectPage } from "./pages/Project";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

// Loaded on first use, so the first page loads less code.
const CompanySettings = lazy(() => import("./components/CompanyDialogs").then((m) => ({ default: m.CompanySettings })));
const NewCompanyDialog = lazy(() => import("./components/CompanyDialogs").then((m) => ({ default: m.NewCompanyDialog })));
const SearchDialog = lazy(() => import("./components/SearchDialog").then((m) => ({ default: m.SearchDialog })));
const Colophon = lazy(() => import("./pages/Colophon").then((m) => ({ default: m.Colophon })));

export function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <Shell />
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

function Shell() {
  const path = usePath();
  const [me, setMe] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<AppConfig>({ appName: "OpenAct", emailEnabled: true, signupMode: "open", aiProvider: "workers-ai" });

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

  if (path === "/colophon")
    return (
      <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
        <Colophon config={config} signedIn={!!me} />
      </Suspense>
    );
  if (me === undefined) return <div className="min-h-dvh bg-background" aria-busy="true" />;
  if (!me) return <SignIn config={config} onSignedIn={setMe} />;
  return (
    <WorkspaceProvider key={me.id}>
      <SignedIn me={me} config={config} onMe={setMe} />
    </WorkspaceProvider>
  );
}

function SignedIn({ me, config, onMe }: { me: User; config: AppConfig; onMe: (u: User | null) => void }) {
  const path = usePath();
  const ws = useWorkspace();
  const [open, setOpen] = useState(readPanelOpen);
  const [dialog, setDialog] = useState<null | "account" | "project" | "company" | "settings" | "search">(null);
  const close = useCallback(() => setDialog(null), []);
  const { reloadProjects } = ws;

  // Keep the side panel's project list fresh when the person moves around.
  useEffect(() => {
    reloadProjects();
  }, [path]);

  // Ctrl+K or Cmd+K opens search from anywhere. Ctrl+B or Cmd+B (in the sidebar) toggles the side panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog((d) => (d === "search" ? null : "search"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(PANEL_KEY, next ? "open" : "collapsed");
    } catch {
      /* Storage can be blocked. The panel still works. */
    }
  };

  const signOut = async (everywhere: boolean) => {
    await api(everywhere ? "/api/me/sign-out-everywhere" : "/api/auth/logout", { method: "POST" }).catch(() => {});
    onMe(null);
    navigate("/", true);
  };

  const match = path.match(/^\/p\/([^/]+)(?:\/(board|timeline|calendar|members))?\/?$/);
  return (
    <SidebarProvider open={open} onOpenChange={onOpenChange} style={{ "--header-height": "calc(var(--spacing) * 12)" } as CSSProperties}>
      <AppSidebar
        me={me}
        appName={config.appName}
        onNewProject={() => setDialog("project")}
        onNewCompany={() => setDialog("company")}
        onCompanySettings={() => setDialog("settings")}
        onAccount={() => setDialog("account")}
        onSearch={() => setDialog("search")}
        onSignOut={signOut}
      />
      <SidebarInset className="min-w-0">
        {match ? (
          <ProjectPage
            key={match[1]}
            projectId={match[1]}
            view={(match[2] as "board" | "timeline" | "calendar" | "members") || "board"}
            me={me}
            config={config}
          />
        ) : (
          <ProjectsPage me={me} onNewProject={() => setDialog("project")} onNewCompany={() => setDialog("company")} />
        )}
      </SidebarInset>
      <Suspense fallback={null}>
        {dialog === "account" && <AccountDialog me={me} onChange={onMe} onSignOut={signOut} onClose={close} />}
        {dialog === "project" && ws.current && <NewProjectDialog company={ws.current} onClose={close} />}
        {dialog === "company" && <NewCompanyDialog onClose={close} />}
        {dialog === "settings" && ws.current && <CompanySettings companyId={ws.current.id} me={me} onClose={close} />}
        {dialog === "search" && ws.current && <SearchDialog companyId={ws.current.id} companyName={ws.current.name} onClose={close} />}
      </Suspense>
    </SidebarProvider>
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
          <span className="text-sm font-medium leading-none">Email</span>
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
