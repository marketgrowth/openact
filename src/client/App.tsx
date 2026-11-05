import { useCallback, useEffect, useState } from "react";
import type { AppConfig, User } from "../shared/types";
import { api, errorText } from "./api";
import { Link, navigate, usePath } from "./router";
import { Avatar, Icon, Logo, Modal, ThemeSwitch, ToastProvider, useToast } from "./ui";
import { SignIn } from "./pages/SignIn";
import { ProjectsPage } from "./pages/Projects";
import { ProjectPage } from "./pages/Project";

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const path = usePath();
  const [me, setMe] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<AppConfig>({ appName: "OpenAct", emailEnabled: true, signupMode: "open", aiProvider: "workers-ai" });
  const [account, setAccount] = useState(false);

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

  const closeAccount = useCallback(() => setAccount(false), []);

  if (me === undefined) return <div className="splash" aria-busy="true" />;
  if (!me) return <SignIn config={config} onSignedIn={setMe} />;

  const match = path.match(/^\/p\/([^/]+)(?:\/(board|timeline|calendar|members))?\/?$/);
  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-in">
          <Link to="/" className="brand" aria-label={`${config.appName} home`}>
            <Logo />
            <span>{config.appName}</span>
          </Link>
          <span className="grow" />
          <ThemeSwitch />
          <button type="button" className="me-btn" onClick={() => setAccount(true)} aria-label="Your account">
            <Avatar id={me.id} name={me.name || me.email} size={30} />
          </button>
        </div>
      </header>
      {match ? (
        <ProjectPage key={match[1]} projectId={match[1]} view={(match[2] as "board" | "timeline" | "calendar" | "members") || "board"} me={me} config={config} />
      ) : (
        <ProjectsPage me={me} />
      )}
      {account && <AccountDialog me={me} onChange={setMe} onClose={closeAccount} />}
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
    </Modal>
  );
}
