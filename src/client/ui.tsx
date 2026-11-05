import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { findLinks, linkLabel, splitLinks } from "./links";
import { getTheme, setTheme, type ThemePref } from "./theme";

/* Icons: one stroke style, 20px grid */

const PATHS: Record<string, string> = {
  plus: "M10 4v12M4 10h12",
  x: "M5 5l10 10M15 5L5 15",
  sun: "M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1",
  moon: "M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z",
  monitor: "M3 4.5h14v9H3zM7.5 16.5h5M10 13.5v3",
  sparkle: "M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  users: "M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5M13 3.2a3 3 0 0 1 0 5.6M15 12.2c1.8.7 3 2.4 3 4.8",
  board: "M3 3.5h4v13H3zM8 3.5h4v9H8zM13 3.5h4v6h-4z",
  timeline: "M3 4h8M6 9h9M4 14h6M3 2v16",
  trash: "M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6M8.5 9v5M11.5 9v5",
  clip: "M15 9.5l-5.6 5.6a3.5 3.5 0 0 1-5-5l6.4-6.4a2.3 2.3 0 0 1 3.3 3.3l-6.3 6.3a1.2 1.2 0 0 1-1.7-1.7l5.6-5.6",
  download: "M10 3v10M6 9l4 4 4-4M4 16.5h12",
  back: "M12 4l-6 6 6 6",
  out: "M8 4H4v12h4M12 6.5L15.5 10 12 13.5M15.5 10H8",
  gear: "M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
  check: "M4 10.5l4 4 8-9",
  calendar: "M3.5 5h13v11.5h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5",
  doc: "M5.5 2.5h6l3 3v12h-9zM11.5 2.5v3h3M7.5 10h5M7.5 13h5",
  flag: "M5 17.5V3M5 3.5h9l-2 3.5 2 3.5H5",
  left: "M12.5 4.5L7 10l5.5 5.5",
  right: "M7.5 4.5L13 10l-5.5 5.5",
  external: "M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5",
  chat: "M3.5 4.5h13v9h-7l-4 3v-3h-2z",
  dots: "M5 10h.01M10 10h.01M15 10h.01",
  shield: "M10 2.5l6 2.5v4.5c0 4-2.6 6.8-6 8-3.4-1.2-6-4-6-8V5z"
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <rect x="6" y="8" width="13" height="4" rx="2" fill="var(--accent-ink)" />
      <rect x="11" y="14" width="15" height="4" rx="2" fill="var(--accent-ink)" opacity=".8" />
      <rect x="8" y="20" width="9" height="4" rx="2" fill="var(--accent-ink)" opacity=".6" />
    </svg>
  );
}

/* Avatar: initials on a stable color picked from the user id */

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ id, name, size = 22 }: { id: string; name: string; size?: number }) {
  return (
    <span className={`av av-${hash(id) % 8}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

/* Toasts */

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast" role="status" aria-live="polite" hidden={!msg}>
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

/* Modal dialog with Escape and focus return */

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not(.icon-btn)");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </>
  );
}

/* Theme switch: System, Light, Dark */

export function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePref>(getTheme);
  const opts: Array<[ThemePref, string, string]> = [
    ["system", "monitor", "Use system theme"],
    ["light", "sun", "Light theme"],
    ["dark", "moon", "Dark theme"]
  ];
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {opts.map(([v, icon, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={pref === v}
          aria-label={label}
          title={label}
          onClick={() => {
            setTheme(v);
            setPref(v);
          }}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}

/** Two-step confirm button. The first click arms it; the second click within 4 seconds runs the action. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = "", disabled }: { label: ReactNode; confirmLabel: string; onConfirm: () => void; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn ${armed ? "danger armed" : "ghost danger"} ${className}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Plain text with its web addresses shown as links that open in a new tab. The text is never read as HTML. */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((s, i) =>
        s.kind === "link" ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="text-link">
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

/** The links found in a text, as a short list. Shows nothing when there are none. */
export function LinkList({ text, label = "Links" }: { text: string; label?: string }) {
  const links = findLinks(text);
  if (!links.length) return null;
  return (
    <ul className="link-list" aria-label={label}>
      {links.map((l) => (
        <li key={l.href}>
          <a href={l.href} target="_blank" rel="noopener noreferrer nofollow" title={l.href}>
            <Icon name="external" size={14} />
            <span>{linkLabel(l.href)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
