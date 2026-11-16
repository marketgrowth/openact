import type { SignInPage } from "./types.ts";

/*
 * Site settings: the name, the logo, the sign-in page and the apps of this deploy.
 * A super admin sets them. Super admins are the emails in SUPER_ADMIN_EMAILS.
 */

/** The longest app name. It must fit the sign-in page, the panel and email subjects. */
export const SITE_NAME_MAX = 40;

/** Image types for the site logo. SVG is not allowed, because it can hold scripts. */
export const SITE_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const SITE_LOGO_MAX_BYTES = 1024 * 1024;

/** The sign-in background uses the same image types as the logo. */
export const SIGN_IN_BACKGROUND_MAX_BYTES = 3 * 1024 * 1024;

/** The default sign-in heading and credit. They show until a super admin sets a heading. */
export const DEFAULT_SIGN_IN_HEADING = "Whether you think you can or think you can't, you're right.";
export const DEFAULT_SIGN_IN_CREDIT = "Henry Ford";
export const SIGN_IN_HEADING_MAX = 160;
export const SIGN_IN_CREDIT_MAX = 60;
export const LEGAL_URL_MAX = 500;

/** GET /api/site. Only signed-in people can read it. */
export interface SiteSettings {
  /** The name that shows now. */
  appName: string;
  /** The name from APP_NAME. It shows when no super admin set a name. */
  defaultName: string;
  /** True when a super admin set a name. */
  customName: boolean;
  /** A URL for the logo, or null for the OpenAct mark. */
  logoUrl: string | null;
  /** True when this person is a super admin. */
  canEdit: boolean;
  /** The sign-in page as it shows now. */
  signIn: SignInPage & {
    /** True when a super admin set a heading. False means the default heading and credit show. */
    customHeading: boolean;
  };
  /** Super admins only: every installed app, and whether it is on for the site. An app that is off is off in every company. */
  apps?: Array<{ id: string; name: string; enabled: boolean }>;
}

/** One company in Site settings > Apps. */
export interface SiteCompanyApps {
  id: string;
  name: string;
  /** The number of people in the company. */
  members: number;
  /** The apps that a super admin turned off for this company. */
  blocked: string[];
}

/** GET /api/site/companies. Super admins only. */
export interface SiteCompanies {
  /** Every installed app. siteOff: the app is off for the whole site, so it is off in every company. */
  apps: Array<{ id: string; name: string; siteOff: boolean }>;
  /** The number of companies on the site. */
  total: number;
  /** With a search: the companies that match. Without one: the first companies by name. */
  companies: SiteCompanyApps[];
}

/** Reads the saved list of apps that are off for the site. Bad data counts as an empty list. */
export function parseAppsOff(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[a-z][a-z0-9-]{1,30}$/.test(x)) : [];
  } catch {
    return [];
  }
}

/** Reads a comma- or space-separated list of emails. Returns lowercase emails without blanks. */
export function parseEmailList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/** True when the email is in the list. Case does not matter. */
export function isSuperAdminEmail(list: string | undefined | null, email: string): boolean {
  const e = email.trim().toLowerCase();
  return !!e && parseEmailList(list).includes(e);
}

/** Cleans an app name: one line, no extra spaces. Returns a problem as text, or the clean name. */
export function cleanSiteName(raw: unknown): { name: string } | { problem: string } {
  if (raw === undefined || raw === null) return { name: "" };
  if (typeof raw !== "string") return { problem: "App name must be text." };
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length > SITE_NAME_MAX) return { problem: `App name is too long. Use ${SITE_NAME_MAX} characters or fewer.` };
  return { name };
}

/** The logo URL with a version, so a new upload is not hidden by the browser cache. */
export const siteLogoUrl = (updatedAt: string) => `/api/site/logo?v=${encodeURIComponent(updatedAt)}`;

/** The sign-in background URL with a version, so a new upload is not hidden by the browser cache. */
export const signInBackgroundUrl = (updatedAt: string) => `/api/site/sign-in-background?v=${encodeURIComponent(updatedAt)}`;

/** Cleans one line of text for the sign-in page. Returns a problem as text, or the clean text. */
export function cleanSignInText(raw: unknown, label: string, max: number): { text: string } | { problem: string } {
  if (raw === undefined || raw === null) return { text: "" };
  if (typeof raw !== "string") return { problem: `${label} must be text.` };
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > max) return { problem: `${label} is too long. Use ${max} characters or fewer.` };
  return { text };
}

/** Cleans a link to a legal page. Only http and https links are allowed. Returns "" for no link. */
export function cleanLegalUrl(raw: unknown, label: string): { url: string } | { problem: string } {
  if (raw === undefined || raw === null) return { url: "" };
  if (typeof raw !== "string") return { problem: `${label} link must be text.` };
  const t = raw.trim();
  if (!t) return { url: "" };
  if (t.length > LEGAL_URL_MAX) return { problem: `${label} link is too long. Use ${LEGAL_URL_MAX} characters or fewer.` };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { problem: `${label} link is not a full web address. Start it with https://.` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { problem: `${label} link must start with https:// or http://.` };
  return { url: u.href };
}
