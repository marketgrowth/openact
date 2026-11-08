/*
 * Site settings: the name and logo of this deploy.
 * A super admin sets them. Super admins are the emails in SUPER_ADMIN_EMAILS.
 */

/** The longest app name. It must fit the sign-in page, the panel and email subjects. */
export const SITE_NAME_MAX = 40;

/** Image types for the site logo. SVG is not allowed, because it can hold scripts. */
export const SITE_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const SITE_LOGO_MAX_BYTES = 1024 * 1024;

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
