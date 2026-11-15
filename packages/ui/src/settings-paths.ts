/*
 * The sections of the Settings page. The side panel lists them, and each one has its own path.
 * Company sections: /settings/company/<id>. Site sections, for super admins: /settings/site/<id>.
 */
import { SETTINGS_PATH } from "./app-paths.ts";

export type SettingsScope = "company" | "site";

export interface SettingsSection {
  scope: SettingsScope;
  id: string;
  label: string;
  /** A Lucide icon name for Icon. */
  icon: string;
  /** One short sentence under the section heading. */
  description?: string;
}

export const COMPANY_SECTIONS: readonly SettingsSection[] = [
  { scope: "company", id: "general", label: "General", icon: "gear", description: "The company name, logo and email domain." },
  { scope: "company", id: "people", label: "People", icon: "users" },
  { scope: "company", id: "apps", label: "Apps", icon: "apps" },
  { scope: "company", id: "permissions", label: "Permissions", icon: "shield" },
  { scope: "company", id: "ai", label: "AI provider", icon: "bot" }
];

export const SITE_SECTIONS: readonly SettingsSection[] = [
  { scope: "site", id: "general", label: "Name and logo", icon: "image", description: "The app name and logo that everyone on this site sees." },
  { scope: "site", id: "sign-in", label: "Sign-in page", icon: "signin", description: "The heading, credit, legal links and background of the sign-in page." },
  {
    scope: "site",
    id: "apps",
    label: "Apps",
    icon: "apps",
    description: "Turn an app off for every company on this site. An app that is off keeps its data. Companies cannot turn it on again until you do."
  }
];

/** The parts of an app that add company sections. ClientApp has all of them. */
export interface SettingsApp {
  icon?: string;
  companySettingsTabs?: ReadonlyArray<{ id: string; label: string }>;
}

/** The company sections: the built-in ones, then each app's sections. An app section with a built-in id is left out. */
export function companySections(apps: readonly SettingsApp[]): SettingsSection[] {
  const out: SettingsSection[] = [...COMPANY_SECTIONS];
  for (const app of apps)
    for (const t of app.companySettingsTabs ?? [])
      if (!out.some((s) => s.id === t.id)) out.push({ scope: "company", id: t.id, label: t.label, icon: app.icon ?? "apps" });
  return out;
}

export const settingsPath = (scope: SettingsScope, id: string): string => `${SETTINGS_PATH}/${scope}/${encodeURIComponent(id)}`;

/** Reads a settings path. "/settings" alone gives no scope, so the page picks the first section the person can open. */
export function parseSettingsPath(path: string): { scope?: SettingsScope; id?: string } | null {
  if (path === SETTINGS_PATH || path === `${SETTINGS_PATH}/`) return {};
  const m = path.match(/^\/settings\/(company|site)(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  let id: string | undefined;
  try {
    id = m[2] ? decodeURIComponent(m[2]) : undefined;
  } catch {
    return null;
  }
  return { scope: m[1] as SettingsScope, id };
}
