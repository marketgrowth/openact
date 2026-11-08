/*
 * Core types shared by the Worker and the web app: people, companies and app config.
 * Apps add their own types in their own packages.
 */

/** Company roles. Guests see only what they are invited to. */
export const COMPANY_ROLES = ["owner", "admin", "member", "guest"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];
export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
export const COMPANY_ROLE_HELP: Record<CompanyRole, string> = {
  owner: "Manages the company, its people, its owners and every company project. Can delete the company.",
  admin: "Manages the company, its people and every company project.",
  member: "Sees every project that the company can see, and can create projects.",
  guest: "Sees only the projects they are invited to."
};

export interface Company {
  id: string;
  name: string;
  role: CompanyRole;
  /** A URL for the logo, or null. */
  logoUrl: string | null;
}

/** GET /api/companies/:id. Apps can add fields, such as their company settings. */
export interface CompanyDetail extends Company {
  emailDomain: string | null;
  members: Array<{ userId: string; email: string; name: string; role: CompanyRole }>;
  invitations: Array<{ id: string; email: string; role: CompanyRole; createdAt: string }>;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AppConfig {
  appName: string;
  /** The site logo that a super admin uploaded, or null for the OpenAct mark. */
  logoUrl: string | null;
  emailEnabled: boolean;
  signupMode: "open" | "invite";
  aiProvider: string;
  /** The installed apps, in order. */
  apps: Array<{ id: string; name: string }>;
}
