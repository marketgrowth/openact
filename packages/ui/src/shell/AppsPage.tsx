import { useMemo, useState, type ReactNode } from "react";
import { canManageCompany } from "@openact/core/shared";
import { railApps, useShell, type ClientApp, type DirectoryApp } from "../apps";
import { Link } from "../router";
import { Icon, Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { PageBody, SiteHeader } from "./SiteHeader";
import { useCompanyApps } from "./AppSettings";
import { appHome } from "../app-paths";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Switch } from "@openact/ui/components/switch";
import { cn } from "@openact/ui/lib/utils";

/*
 * The Apps page: the apps in the current company, then apps from the directory.
 * Owners and admins turn installed apps on or off here. Adding an app from the directory is a code change, so the page shows the command.
 */

const DIRECTORY_URL = "https://docs.openact.app/directory";

const STATUS: Record<DirectoryApp["status"], string> = {
  "built-in": "Built in",
  available: "Available",
  planned: "Under review",
  example: "Example"
};

export function AppsPage() {
  const { apps, directory } = useShell();
  const ws = useWorkspace();
  const current = ws.current;
  const manager = canManageCompany(current?.role ?? null);
  const installed = railApps(apps);
  const installedIds = new Set(apps.map((a) => a.id));
  const more = directory.filter((d) => !installedIds.has(d.id) && d.status !== "built-in");
  const info = (id: string) => directory.find((d) => d.id === id);

  return (
    <>
      <SiteHeader title={current?.name ?? "Apps"}>
        <Button asChild variant="outline" size="sm">
          <a href={DIRECTORY_URL} target="_blank" rel="noreferrer">
            <Icon name="external" /> <span className="hidden sm:inline">Directory on the web</span>
          </a>
        </Button>
      </SiteHeader>
      <PageBody>
        <div className="grid gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Apps</h2>
          <p className="text-sm text-muted-foreground">
            {current ? `The apps in ${current.name}, and apps you can add from the directory.` : "Make a company to use apps."}
          </p>
        </div>

        <section className="grid gap-3" aria-labelledby="apps-installed" data-apps-installed="">
          <h3 id="apps-installed" className="text-sm font-medium">
            In this company
          </h3>
          {current && manager ? (
            <ManagedApps companyId={current.id} installed={installed} info={info} />
          ) : (
            <MemberApps installed={installed} info={info} />
          )}
        </section>

        {more.length > 0 && <DirectorySection apps={more} />}
      </PageBody>
    </>
  );
}

/** Owners and admins see every installed app, with its switch. */
function ManagedApps({ companyId, installed, info }: { companyId: string; installed: ClientApp[]; info: (id: string) => DirectoryApp | undefined }) {
  const { apps: settings, error, busy, save } = useCompanyApps(companyId);
  const { apps } = useShell();
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!settings) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {installed.map((app) => {
        const s = settings.find((x) => x.id === app.id);
        const on = s?.enabled ?? false;
        return (
          <AppCard
            key={app.id}
            app={app}
            summary={info(app.id)?.summary}
            on={on}
            action={
              <>
                {s?.siteOff && <span className="mr-auto text-xs text-muted-foreground">Off for this site</span>}
                {on && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={appHome(app, apps)}>Open</Link>
                  </Button>
                )}
                <Switch
                  checked={on}
                  disabled={busy || !s || s.siteOff}
                  onCheckedChange={(next) => save(app.id, { enabled: next }, `${app.name} is ${next ? "on" : "off"}.`)}
                  aria-label={`${app.name} app`}
                />
              </>
            }
          />
        );
      })}
    </ul>
  );
}

/** Members see the apps that are on. */
function MemberApps({ installed, info }: { installed: ClientApp[]; info: (id: string) => DirectoryApp | undefined }) {
  const ws = useWorkspace();
  const { apps } = useShell();
  const off = ws.access?.disabledApps ?? [];
  const shown = installed.filter((a) => !off.includes(a.id));
  if (!shown.length) return <p className="text-sm text-muted-foreground">No apps are on for this company. Ask an owner or admin.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {shown.map((app) => (
        <AppCard
          key={app.id}
          app={app}
          summary={info(app.id)?.summary}
          on
          action={
            <Button asChild size="sm" variant="outline">
              <Link to={appHome(app, apps)}>Open</Link>
            </Button>
          }
        />
      ))}
    </ul>
  );
}

function AppCard({ app, summary, on, action }: { app: ClientApp; summary?: string; on: boolean; action: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-installed-app={app.id}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
          {app.Mark ? <app.Mark className="size-4" /> : <Icon name={app.icon!} />}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{app.name}</span>
        <Badge variant={on ? "secondary" : "outline"}>{on ? "On" : "Off"}</Badge>
      </div>
      {summary && <p className="flex-1 text-sm text-muted-foreground">{summary}</p>}
      <div className="flex items-center justify-end gap-2">{action}</div>
    </li>
  );
}

/** Apps from the directory that this OpenAct does not have yet. */
function DirectorySection({ apps }: { apps: readonly DirectoryApp[] }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((a) => !q || [a.name, a.id, a.summary, a.category].some((s) => s.toLowerCase().includes(q)));
  }, [apps, query]);
  const command = (a: DirectoryApp) => (a.status === "available" || a.status === "example" ? `npm run openact -- add ${a.id}` : null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied the install command.");
    } catch {
      toast("Select the command to copy it.");
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="apps-directory" data-apps-directory="">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 id="apps-directory" className="text-sm font-medium">
            From the directory
          </h3>
          <p className="text-xs text-muted-foreground">To add an app, run its command in your OpenAct folder, then deploy.</p>
        </div>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps" aria-label="Search the directory" className="h-8 w-full sm:w-56" />
      </div>
      {!shown.length && <p className="text-sm text-muted-foreground">No apps match. Try another word.</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((a) => {
          const cmd = command(a);
          return (
            <li key={a.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-directory-app={a.id}>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg font-semibold",
                    a.status === "planned" ? "border border-dashed text-muted-foreground" : "bg-secondary text-secondary-foreground"
                  )}
                  aria-hidden="true"
                >
                  {a.name.charAt(0)}
                </span>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {a.category} · {a.publisher}
                  </span>
                </span>
                <Badge variant="outline">{STATUS[a.status]}</Badge>
              </div>
              <p className="flex-1 text-sm text-muted-foreground">{a.summary}</p>
              <div className="flex items-center justify-between gap-2">
                <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{a.id}</code>
                {cmd ? (
                  <Button size="sm" variant="ghost" onClick={() => copy(cmd)} title={cmd}>
                    Copy install command
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{a.status === "planned" ? "Not ready to install" : ""}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
