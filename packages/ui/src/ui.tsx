import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Calendar,
  ChartGantt,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  Flag,
  FolderKanban,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  Package,
  Paperclip,
  Pin,
  PinOff,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  SquareKanban,
  Sun,
  Trash2,
  UserRoundSearch,
  Users,
  Video,
  X,
  LayoutGrid,
  Send,
  History,
  type LucideIcon
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@openact/ui/components/dialog";
import { Button } from "@openact/ui/components/button";
import { ToggleGroup, ToggleGroupItem } from "@openact/ui/components/toggle-group";
import { cn } from "@openact/ui/lib/utils";
import { findLinks, linkLabel, splitLinks } from "./links";
import { getTheme, setTheme, type ThemePref } from "./theme";

/* Icons: Lucide, by the short names the app uses. */

const ICONS: Record<string, LucideIcon> = {
  plus: Plus,
  x: X,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  sparkle: Sparkles,
  users: Users,
  board: SquareKanban,
  projects: FolderKanban,
  timeline: ChartGantt,
  trash: Trash2,
  clip: Paperclip,
  download: Download,
  back: ArrowLeft,
  out: LogOut,
  gear: Settings,
  check: Check,
  calendar: Calendar,
  doc: FileText,
  flag: Flag,
  left: ChevronLeft,
  right: ChevronRight,
  search: Search,
  chevron: ChevronDown,
  updown: ChevronsUpDown,
  menu: Menu,
  external: ExternalLink,
  chat: MessageSquare,
  dots: Ellipsis,
  shield: Lock,
  bot: Bot,
  pin: Pin,
  unpin: PinOff,
  clock: Clock,
  star: Star,
  briefcase: BriefcaseBusiness,
  plug: Plug,
  talent: UserRoundSearch,
  video: Video,
  box: Package,
  apps: LayoutGrid,
  send: Send,
  history: History
};

export function Icon({ name, size = 16, className }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  const C = ICONS[name] ?? Ellipsis;
  return <C size={size} className={className} aria-hidden="true" />;
}

/** The site logo. Without `src`, it draws the OpenAct mark. */
export function Logo({ size = 24, src }: { size?: number; src?: string | null }) {
  if (src) return <img src={src} width={size} height={size} alt="" className="shrink-0 rounded-[22%] object-contain" data-site-logo="" />;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="7" fill="var(--brand)" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="var(--brand-foreground)" strokeWidth="4.5" />
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
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ id, name, size = 22, className }: { id: string; name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-[var(--av-ink)]", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `var(--av-${hash(id) % 8})` }}
      title={name}
      aria-label={name}
      data-avatar=""
    >
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
    timer.current = window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        hidden={!msg}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[60] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-lg"
      >
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

/* Modal: a shadcn Dialog with a title. Escape, focus trapping and focus return come from Radix. */

export function Modal({
  title,
  description,
  onClose,
  children,
  wide
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/* Theme switch: System, Light, Dark */

export function ThemeSwitch({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>(getTheme);
  const opts: Array<[ThemePref, string, string]> = [
    ["system", "monitor", "Use system theme"],
    ["light", "sun", "Light theme"],
    ["dark", "moon", "Dark theme"]
  ];
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={pref}
      aria-label="Theme"
      className={className}
      onValueChange={(v) => {
        if (!v) return;
        setTheme(v as ThemePref);
        setPref(v as ThemePref);
      }}
    >
      {opts.map(([v, icon, label]) => (
        <ToggleGroupItem key={v} value={v} aria-label={label} title={label}>
          <Icon name={icon} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Two-step confirm button. The first click arms it; the second click within 4 seconds runs the action. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  disabled,
  size = "sm"
}: {
  label: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <Button
      type="button"
      size={size}
      variant={armed ? "destructive" : "ghost"}
      className={cn(!armed && "text-destructive hover:text-destructive", className)}
      disabled={disabled}
      data-armed={armed || undefined}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

/** Plain text with its web addresses shown as links that open in a new tab. The text is never read as HTML. */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((s, i) =>
        s.kind === "link" ? (
          <a
            key={i}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all font-medium text-foreground underline underline-offset-4"
          >
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
    <ul className="flex flex-wrap gap-1.5" aria-label={label} data-links="">
      {links.map((l) => (
        <li key={l.href} className="min-w-0">
          <a
            href={l.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={l.href}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-xs hover:bg-accent"
          >
            <Icon name="external" size={12} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{linkLabel(l.href)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A short notice: a warning or an error message. */
export function Notice({ children, tone = "warn", className }: { children: ReactNode; tone?: "warn" | "error" | "info"; className?: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "warn" && "border-warn-border bg-warn text-warn-foreground",
        tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "info" && "bg-muted text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

/** A form field: a label, the control, and optional help text. */
export function Field({
  label,
  htmlFor,
  help,
  children,
  className
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
        {label}
      </label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
