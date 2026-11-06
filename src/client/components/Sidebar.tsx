import { useEffect, useRef, useState } from "react";
import { COMPANY_ROLE_LABELS, type Company, type User } from "../../shared/types";
import { canCreateProjects, canManageCompany } from "../../shared/access";
import { Link, usePath } from "../router";
import { Avatar, Icon, ThemeSwitch } from "../ui";
import { useWorkspace } from "../workspace";

/** A company's logo, or its initials on a colored square. */
export function CompanyMark({ company, size = 32 }: { company: Pick<Company, "id" | "name" | "logoUrl">; size?: number }) {
  if (company.logoUrl) return <img className="co-mark" src={company.logoUrl} alt="" width={size} height={size} />;
  const initials =
    company.name
      .split(/\s+/)
      .filter((w) => /[a-z0-9]/i.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span className="co-mark co-initials" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials}
    </span>
  );
}

export interface SidebarProps {
  me: User;
  appName: string;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onNewProject: () => void;
  onNewCompany: () => void;
  onCompanySettings: () => void;
  onAccount: () => void;
  onSearch: () => void;
}

/** The left side panel: the company switcher, the company's projects, and the person's settings. */
export function Sidebar(p: SidebarProps) {
  const ws = useWorkspace();
  const path = usePath();
  const current = ws.current;
  const canCreate = canCreateProjects(current?.role ?? null);
  const canManage = canManageCompany(current?.role ?? null);
  const label = (text: string) => (p.collapsed ? { title: text, "aria-label": text } : {});

  return (
    <aside className="sidepanel" aria-label="Main">
      <div className="sp-head">
        <CompanySwitcher appName={p.appName} collapsed={p.collapsed} onNewCompany={p.onNewCompany} onCompanySettings={p.onCompanySettings} onPick={p.onNavigate} />
        <button type="button" className="sp-toggle" onClick={p.onToggle} aria-label={p.collapsed ? "Open the side panel" : "Close the side panel"} aria-expanded={!p.collapsed}>
          <Icon name={p.collapsed ? "right" : "left"} size={14} />
        </button>
      </div>

      <nav className="sp-nav" aria-label="Projects">
        {current && (
          <button type="button" className="sp-item" onClick={p.onSearch} aria-keyshortcuts="Control+K Meta+K" {...label("Search")}>
            <Icon name="search" size={18} />
            <span className="sp-label">Search</span>
            {!p.collapsed && <kbd className="sp-kbd">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd>}
          </button>
        )}
        <Link to="/" className="sp-item" aria-current={path === "/" ? "page" : undefined} onClick={p.onNavigate} {...label("All projects")}>
          <Icon name="board" size={18} />
          <span className="sp-label">All projects</span>
        </Link>
        {current && <p className="sp-section">Projects</p>}
        {ws.projects === null && current && <p className="sp-empty sp-label">Loading…</p>}
        {ws.projects?.map((proj) => {
          const active = path === `/p/${proj.id}` || path.startsWith(`/p/${proj.id}/`);
          return (
            <Link
              key={proj.id}
              to={`/p/${proj.id}`}
              className="sp-item"
              aria-current={active ? "page" : undefined}
              onClick={p.onNavigate}
              {...label(proj.visibility === "secret" ? `${proj.name} (secret)` : proj.name)}
            >
              <span className={`sp-dot pc-${proj.color}`} aria-hidden="true" />
              <span className="sp-label">{proj.name}</span>
              {proj.visibility === "secret" && !p.collapsed && (
                <span className="sp-lock" title="Secret project">
                  <Icon name="shield" size={13} />
                </span>
              )}
            </Link>
          );
        })}
        {ws.projects && !ws.projects.length && current && <p className="sp-empty sp-label">No projects yet.</p>}
        {canCreate && (
          <button type="button" className="sp-item sp-add" onClick={p.onNewProject} {...label("New project")}>
            <Icon name="plus" size={18} />
            <span className="sp-label">New project</span>
          </button>
        )}
      </nav>

      <div className="sp-foot">
        {canManage && (
          <button type="button" className="sp-item" onClick={p.onCompanySettings} {...label("Company settings")}>
            <Icon name="gear" size={18} />
            <span className="sp-label">Company settings</span>
          </button>
        )}
        <Link to="/colophon" className="sp-item" onClick={p.onNavigate} {...label("Colophon")}>
          <Icon name="doc" size={18} />
          <span className="sp-label">Colophon</span>
        </Link>
        {!p.collapsed && (
          <div className="sp-theme">
            <ThemeSwitch />
          </div>
        )}
        <button type="button" className="sp-item sp-me" onClick={p.onAccount} {...label("Your account")}>
          <Avatar id={p.me.id} name={p.me.name || p.me.email} size={26} />
          <span className="sp-label">
            <span className="sp-me-name">{p.me.name || p.me.email}</span>
            <span className="sp-me-mail">{p.me.email}</span>
          </span>
        </button>
      </div>
    </aside>
  );
}

function CompanySwitcher({
  appName,
  collapsed,
  onNewCompany,
  onCompanySettings,
  onPick
}: {
  appName: string;
  collapsed: boolean;
  onNewCompany: () => void;
  onCompanySettings: () => void;
  onPick: () => void;
}) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = ws.current;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = async (id: string) => {
    setOpen(false);
    onPick();
    if (id !== current?.id) await ws.switchTo(id);
  };

  return (
    <div className="co-switch" ref={box}>
      <button
        type="button"
        className="co-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `Company: ${current.name}. Change company` : "Choose a company"}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? <CompanyMark company={current} /> : <span className="co-mark co-initials co-empty"><Icon name="plus" size={16} /></span>}
        <span className="co-text sp-label">
          <span className="co-name">{current?.name ?? "No company yet"}</span>
          <span className="co-app">{appName}</span>
        </span>
        <span className="co-chev sp-label" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open && (
        <div className={`co-menu${collapsed ? " is-side" : ""}`} role="menu" aria-label="Companies">
          <p className="co-menu-h">Your companies</p>
          {(ws.companies ?? []).map((co) => (
            <button key={co.id} type="button" role="menuitemradio" aria-checked={co.id === current?.id} className="co-opt" onClick={() => pick(co.id)}>
              <CompanyMark company={co} size={26} />
              <span className="co-opt-text">
                <span className="co-name">{co.name}</span>
                <span className="co-role">{COMPANY_ROLE_LABELS[co.role]}</span>
              </span>
              {co.id === current?.id && <Icon name="check" size={16} />}
            </button>
          ))}
          <hr />
          {current && canManageCompany(current.role) && (
            <button
              type="button"
              role="menuitem"
              className="co-opt co-act"
              onClick={() => {
                setOpen(false);
                onCompanySettings();
              }}
            >
              <Icon name="gear" size={16} /> Company settings
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="co-opt co-act"
            onClick={() => {
              setOpen(false);
              onNewCompany();
            }}
          >
            <Icon name="plus" size={16} /> Create a company
          </button>
        </div>
      )}
    </div>
  );
}
