/*
 * Company access rules. Pure module, used by the Worker, the web app and tests.
 */
import type { CompanyRole } from "./types";

export const canManageCompany = (r: CompanyRole | null) => r === "owner" || r === "admin";

/** Public email providers. A company cannot claim these for auto-join. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "qq.com",
  "163.com"
]);

/** Checks a domain for auto-join. Returns an error message, or null when it is fine. */
export function emailDomainProblem(domain: string, adminEmail: string): string | null {
  const d = domain.trim().toLowerCase();
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return "Type a domain such as example.com, without @.";
  if (PUBLIC_EMAIL_DOMAINS.has(d)) return "Public email domains, such as gmail.com, cannot be used for auto-join.";
  if (adminEmail.toLowerCase().split("@")[1] !== d) return `Your own email must use ${d} before you can set it for auto-join.`;
  return null;
}
