/*
 * Partner domains: white label for agencies and other partners. See docs/partners.md.
 * Rules and types that the server and the web app share.
 */

export const PARTNER_NAME_MAX = 40;
/** The most host names that one company can have. */
export const PARTNER_HOSTS_MAX = 5;

/** A partner domain, as Site settings shows it. */
export interface PartnerDomain {
  host: string;
  companyId: string;
  companyName: string;
  /** The name people see on this host. Without one, the company name shows. */
  name: string | null;
  /** Client companies that the partner made on its hosts. */
  clients: number;
  createdAt: string;
  /** The partner's settings. They belong to its company, so every host of the company shows the same values. */
  paused: boolean;
  ownAiRequired: boolean;
}

/** GET /api/site/partners/company/:companyId/clients. For super admins: one partner's client companies and their people. */
export interface PartnerClientPeople {
  partner: { companyId: string; name: string };
  clients: Array<{
    id: string;
    name: string;
    createdAt: string;
    people: Array<{
      userId: string;
      name: string;
      email: string;
      role: "owner" | "admin" | "member" | "guest";
      /** True when the person is also in the partner's company: one of the partner's people. */
      partnerPerson: boolean;
    }>;
  }>;
}

/** POST /api/site/partners/clients/:companyId/handover */
export interface PartnerHandover {
  /** The person who becomes an owner. They must be in the company, and not as a guest. */
  userId: string;
  /** Removes the partner's people from the company. The new owner stays. */
  removePartnerPeople?: boolean;
  /** Takes the company away from the partner: it stops counting as the partner's client, and a pause no longer applies. */
  release?: boolean;
}

/** One client company of a partner, as the partner's Company settings shows it. */
export interface PartnerClient {
  id: string;
  name: string;
  /** People in the client company. */
  members: number;
  createdAt: string;
}

export interface PartnerClients {
  /** The partner's host names, such as app.brightline.com. */
  hosts: string[];
  clients: PartnerClient[];
}

/**
 * Cleans a host name that a super admin typed. Accepts "App.Brightline.com", "https://app.brightline.com/" and
 * "app.brightline.com:443". Returns the bare lowercase host name, or a problem to show.
 */
export function cleanHost(raw: unknown): { host: string } | { problem: string } {
  if (typeof raw !== "string" || !raw.trim()) return { problem: "Type a host name, such as app.brightline.com." };
  let s = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { problem: "That is not a host name. Type one such as app.brightline.com." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { problem: "Type a web host name, such as app.brightline.com." };
  if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash)
    return { problem: "Type only the host name, such as app.brightline.com, with no path." };
  const host = u.hostname.replace(/\.$/, "");
  if (host.length > 253 || !host.includes(".") || !/^[a-z0-9.-]+$/.test(host) || host.split(".").some((p) => !p || p.length > 63 || p.startsWith("-") || p.endsWith("-")))
    return { problem: "That is not a host name. Type one such as app.brightline.com." };
  if (/^\d+(\.\d+){3}$/.test(host)) return { problem: "Use a host name, not an IP address." };
  return { host };
}

/** Cleans the name that people see on a partner host. Empty means: use the company name. */
export function cleanPartnerName(raw: unknown): { name: string } | { problem: string } {
  if (raw === undefined || raw === null) return { name: "" };
  if (typeof raw !== "string") return { problem: "The name must be text." };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length > PARTNER_NAME_MAX) return { problem: `The name is too long. Use ${PARTNER_NAME_MAX} characters or fewer.` };
  return { name };
}

/** The address of a partner's logo on its own host. It changes when the logo changes, so browsers load the new one. */
export const partnerLogoUrl = (updatedAt: string) => `/api/partner/logo?v=${encodeURIComponent(updatedAt)}`;
