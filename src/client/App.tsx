import { useCallback, useEffect, useState } from "react";
import type { AppConfig, User } from "../shared/types";
import { api, errorText } from "./api";
import { Link, navigate, usePath } from "./router";
import { Icon, Logo, Modal, ToastProvider, useToast } from "./ui";
import { SignIn } from "./pages/SignIn";
import { NewProjectDialog, ProjectsPage } from "./pages/Projects";
import { CompanyMark, Sidebar } from "./components/Sidebar";
import { CompanySettings, NewCompanyDialog } from "./components/CompanyDialogs";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { ProjectPage } from "./pages/Project";
import { Colophon } from "./pages/Colophon";

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

const COLLAPSE_KEY = "openact-sidepanel";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
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

  if (path === "/colophon") return <Colophon config={config} signedIn={!!me} />;
  if (me === undefined) return <div className="splash" aria-busy="true" />;
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "account" | "project" | "company" | "settings">(null);
  const close = useCallback(() => setDialog(null), []);
  const { reloadProjects } = ws;

  // Keep the side panel's project list fresh when the person moves around.
  useEffect(() => {
    reloadProjects();
    setMobileOpen(false);
  }, [path]);

  const toggle = () => {
    // On a phone the button closes the drawer. On a wide screen it collapses the panel.
    if (window.matchMedia("(max-width: 860px)").matches) {
      setMobileOpen(false);
      return;
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "open" : "collapsed");
      } catch {
        /* Storage can be blocked. The panel still works. */
      }
      return !c;
    });
  };

  const match = path.match(/^\/p\/([^/]+)(?:\/(board|timeline|calendar|members))?\/?$/);
  return (
    <div className={`layout${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-open" : ""}`}>
      <Sidebar
        me={me}
        appName={config.appName}
        collapsed={collapsed && !mobileOpen}
        onToggle={toggle}
        onNavigate={() => setMobileOpen(false)}
        onNewProject={() => setDialog("project")}
        onNewCompany={() => setDialog("company")}
        onCompanySettings={() => setDialog("settings")}
        onAccount={() => setDialog("account")}
      />
      <div className="sp-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      <div className="main">
        <header className="mobilebar">
          <button type="button" className="icon-btn" aria-label="Open the menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <Icon name="menu" />
          </button>
          {ws.current ? <CompanyMark company={ws.current} size={26} /> : <Logo />}
          <span className="mobilebar-name">{ws.current?.name ?? config.appName}</span>
        </header>
        {match ? (
          <ProjectPage key={match[1]} projectId={match[1]} view={(match[2] as "board" | "timeline" | "calendar" | "members") || "board"} me={me} config={config} />
        ) : (
          <ProjectsPage me={me} onNewProject={() => setDialog("project")} onNewCompany={() => setDialog("company")} />
        )}
      </div>
      {dialog === "account" && <AccountDialog me={me} onChange={onMe} onClose={close} />}
      {dialog === "project" && ws.current && <NewProjectDialog company={ws.current} onClose={close} />}
      {dialog === "company" && <NewCompanyDialog onClose={close} />}
      {dialog === "settings" && ws.current && <CompanySettings companyId={ws.current.id} me={me} onClose={close} />}
    </div>
  );
}

function AccountDialog({ me, onChange, onClose }: { me: User; onChange: (u: User | null) => void; onClose: () => void }) {
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
  const signOut = async (everywhere: boolean) => {
    await api(everywhere ? "/api/me/sign-out-everywhere" : "/api/auth/logout", { method: "POST" }).catch(() => {});
    onChange(null);
    navigate("/", true);
  };
  return (
    <Modal title="Your account" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field">
          <label htmlFor="acc-name">Name</label>
          <input id="acc-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <span className="lbl">Email</span>
          <span className="mono">{me.email}</span>
        </div>
        <div className="row-end">
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Save name
          </button>
        </div>
      </form>
      <hr />
      <div className="row-wrap">
        <button type="button" className="btn" onClick={() => signOut(false)}>
          <Icon name="out" size={16} /> Sign out
        </button>
        <button type="button" className="btn ghost" onClick={() => signOut(true)}>
          Sign out on all devices
        </button>
      </div>
      <p className="hint">
        <Link to="/colophon" onClick={onClose}>
          How OpenAct is made
        </Link>{" "}
        · Open source by MarketGrowth
      </p>
    </Modal>
  );
}
