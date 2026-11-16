import { useCallback, useEffect, useState } from "react";
import { canManageCompany, type CompanyDetail, type SiteSettings, type User } from "@openact/core/shared";
import type { ClientApp } from "../apps";
import { api, errorText } from "../api";
import { navigate, usePath } from "../router";
import { Notice } from "../ui";
import { useWorkspace } from "../workspace";
import { ACCOUNT_SECTIONS, SITE_SECTIONS, companySections, parseSettingsPath, settingsPath, type SettingsSection } from "../settings-paths";
import { PageBody, SiteHeader } from "./SiteHeader";
import { CompanyMark } from "./Sidebar";
import { GeneralTab, PeopleTab } from "./CompanyDialogs";
import { AppsTab, PermissionsTab } from "./AppSettings";
import { CompanyAiTab } from "./CompanyAi";
import { SitePlan } from "./Plan";
import { SiteSettingsSection, type SiteSection } from "./SiteSettings";
import { SiteGrants } from "./SiteGrants";
import { ProfileSection, SecuritySection } from "./AccountSettings";

/*
 * The Settings page. It fills the main content area, and the side panel lists its sections.
 * Company settings are for company owners and admins. Personal account settings are for everyone.
 * Site settings are for super admins. The side panel lists them in that order.
 * Each section has its own address, so the back button and links work, and the page keeps its place.
 */

type Detail = CompanyDetail & Record<string, unknown>;

export function SettingsPage({
  me,
  apps,
  superAdmin,
  onSite,
  onMe,
  onSignOut
}: {
  me: User;
  apps: readonly ClientApp[];
  /** True for super admins. Only they see Site settings. undefined while it loads. */
  superAdmin?: boolean;
  onSite: (s: SiteSettings) => void;
  onMe: (u: User | null) => void;
  onSignOut: (everywhere: boolean) => void;
}) {
  const path = usePath();
  const ws = useWorkspace();
  const current = ws.current;
  const manager = canManageCompany(current?.role ?? null);
  const where = parseSettingsPath(path);
  const sections = companySections(apps);

  // "/settings" alone opens the company settings for owners and admins, and the profile for everyone else.
  const start = manager ? settingsPath("company", "general") : settingsPath("account", "profile");
  const waiting = ws.companies === null;
  const scope = where?.scope;
  const id = where?.id;
  useEffect(() => {
    if (!where || waiting) return;
    if (!scope && start) navigate(start, true);
    else if (scope && !id) navigate(settingsPath(scope, "general"), true);
  }, [where === null, scope, id, start, waiting]);

  if (!where) return <Missing />;
  if (!scope || !id) return <Loading title="Settings" />;

  if (scope === "account") {
    const section = ACCOUNT_SECTIONS.find((s) => s.id === id);
    if (!section) return <Missing />;
    return (
      <Shell title="Personal account" section={section}>
        {section.id === "profile" ? <ProfileSection key={me.id} me={me} onMe={onMe} /> : <SecuritySection me={me} onMe={onMe} onSignOut={onSignOut} />}
      </Shell>
    );
  }

  if (scope === "site") {
    const section = SITE_SECTIONS.find((s) => s.id === id);
    if (!section) return <Missing />;
    if (superAdmin === undefined) return <Loading title="Site settings" />;
    if (!superAdmin)
      return (
        <Shell title="Site settings" section={section}>
          <Notice tone="info">Only super admins can open Site settings. Ask the person who runs this site.</Notice>
        </Shell>
      );
    return (
      <Shell title="Site settings" section={section}>
        {section.id === "grants" ? <SiteGrants /> : section.id === "plan" ? <SitePlan /> : <SiteSettingsSection key={section.id} section={section.id as SiteSection} onSaved={onSite} />}
      </Shell>
    );
  }

  const section = sections.find((s) => s.id === id);
  if (!section) return <Missing />;
  if (ws.companies === null) return <Loading title="Company settings" />;
  if (!current)
    return (
      <Shell title="Company settings" section={section}>
        <Notice tone="info">You are not in a company yet. Create one from the company menu at the top of the side panel.</Notice>
      </Shell>
    );
  if (!manager)
    return (
      <Shell title="Company settings" section={section}>
        <Notice tone="info">Only owners and admins of {current.name} can change its settings. Ask one of them for help.</Notice>
      </Shell>
    );
  return <CompanySection key={current.id} companyId={current.id} me={me} apps={apps} section={section} />;
}

/** One company section. It loads the company once, and loads it again after a change. */
function CompanySection({ companyId, me, apps, section }: { companyId: string; me: User; apps: readonly ClientApp[]; section: SettingsSection }) {
  const ws = useWorkspace();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api<Detail>(`/api/companies/${companyId}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [companyId]);
  useEffect(() => {
    load();
  }, [load]);

  const changed = async () => {
    await load();
    await ws.reloadCompanies();
  };

  const appTab = apps.flatMap((a) => a.companySettingsTabs ?? []).find((t) => t.id === section.id);
  let body;
  if (error) body = <Notice tone="error">{error}</Notice>;
  else if (!detail) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else if (section.id === "general") body = <GeneralTab key={detail.id} detail={detail} me={me} onChanged={changed} />;
  else if (section.id === "people") body = <PeopleTab detail={detail} me={me} onChanged={changed} />;
  else if (section.id === "apps") body = <AppsTab companyId={companyId} />;
  else if (section.id === "permissions") body = <PermissionsTab companyId={companyId} />;
  else if (section.id === "ai") body = <CompanyAiTab companyId={companyId} />;
  else if (appTab) body = <appTab.Tab key={appTab.id} detail={detail} onChanged={changed} />;

  return (
    <Shell
      title="Company settings"
      section={section}
      company={detail ?? undefined}
      count={section.id === "people" && detail ? detail.members.length : undefined}
    >
      {body}
    </Shell>
  );
}

/** The page frame: the header, then the section heading and its content in a column of steady width. */
function Shell({
  title,
  section,
  company,
  count,
  children
}: {
  title: string;
  section?: SettingsSection;
  company?: Detail;
  count?: number;
  children: React.ReactNode;
}) {
  const ws = useWorkspace();
  const name = company?.name ?? (section?.scope === "company" ? ws.current?.name : undefined);
  return (
    <>
      <SiteHeader title={section ? `${title}: ${section.label}` : title} />
      <PageBody>
        <div className="grid w-full max-w-3xl gap-6" data-settings-section={section ? `${section.scope}/${section.id}` : ""}>
          <div className="grid gap-1">
            {section?.scope === "company" && name && (
              <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground" data-company-head="">
                {company && <CompanyMark company={company} size={24} className="rounded-md" />}
                <span className="truncate">{name}</span>
              </div>
            )}
            <h2 className="text-2xl font-semibold tracking-tight">
              {section?.label ?? title}
              {count !== undefined && <span className="ml-2 text-base font-normal text-muted-foreground">({count})</span>}
            </h2>
            {section?.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
          </div>
          {children}
        </div>
      </PageBody>
    </>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <>
      <SiteHeader title={title} />
      <PageBody>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </PageBody>
    </>
  );
}

function Missing() {
  return (
    <Shell title="Settings">
      <Notice tone="info">This settings page does not exist. Pick a section in the side panel.</Notice>
    </Shell>
  );
}
