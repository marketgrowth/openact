/*
 * Rules for the CMS app. Pure functions, so the server, the web app and the tests share them.
 */

/** Where the app's API lives. */
export const API = "/api/apps/cms";

/** The app's page in OpenAct. */
export const CMS_HOME = "/a/cms";

/** The Company settings section for the app. */
export const CMS_SETTINGS = "/settings/company/cms";

/** EmDash mounts its admin at this path on the site. */
export const ADMIN_PATH = "/_emdash/admin/";

export const SITE_URL_MAX = 300;

/** What the page and the settings tab read. */
export interface CmsSite {
  /** The EmDash site address, such as https://cms.example.com. Null until an owner or admin sets it. */
  siteUrl: string | null;
  /** True for company owners and admins. They can change the address in Company settings. */
  canManage: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Cleans the EmDash site address that a company owner or admin types.
 * Accepts the site address or the admin address, and keeps the site part:
 * "https://cms.example.com/_emdash/admin/posts" becomes "https://cms.example.com".
 * Only https is allowed, except http for a site on this computer. Returns "" for no address.
 */
export function cleanSiteUrl(raw: unknown): { url: string } | { problem: string } {
  if (raw === undefined || raw === null) return { url: "" };
  if (typeof raw !== "string") return { problem: "The EmDash address must be text." };
  let t = raw.trim();
  if (!t) return { url: "" };
  if (t.length > SITE_URL_MAX) return { problem: `The EmDash address is too long. Use ${SITE_URL_MAX} characters or fewer.` };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = `https://${t}`;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { problem: "The EmDash address is not a web address. Type it like https://cms.example.com." };
  }
  const local = LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return { problem: "The EmDash address must start with https://." };
  if (u.username || u.password) return { problem: "Remove the user name and password from the EmDash address." };
  // Keep the site part. A path before /_emdash stays, for a site that runs under a base path.
  let path = u.pathname;
  const at = path.indexOf("/_emdash");
  if (at >= 0) path = path.slice(0, at);
  path = path.replace(/\/+$/, "");
  return { url: `${u.origin}${path}` };
}

/** The EmDash admin for a site address from cleanSiteUrl. */
export const adminUrl = (siteUrl: string): string => `${siteUrl}${ADMIN_PATH}`;
