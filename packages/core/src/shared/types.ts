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
  /** The company's active workspaces, the default one first. GET /api/companies fills it. Every company has at least one. */
  workspaces?: Workspace[];
}

/*
 * Workspaces: named slices of a company's work. They are flat, and they use the company roles.
 * The kind changes only the label. Every company has one default workspace, which cannot be archived.
 */
export const WORKSPACE_KINDS = ["brand", "business_unit", "location", "region"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];
export const WORKSPACE_KIND_LABELS: Record<WorkspaceKind, string> = { brand: "Brand", business_unit: "Business unit", location: "Location", region: "Region" };

/** The most workspaces one company can have, archived ones included. */
export const MAX_WORKSPACES_PER_COMPANY = 50;

/** The value of the workspace switcher that shows every workspace. Only owners and admins can pick it. */
export const ALL_WORKSPACES = "all";

export interface WorkspaceColors {
  /** A hex color, such as "#1f2937". */
  primary?: string;
  accent?: string;
}

export interface Workspace {
  id: string;
  companyId: string;
  name: string;
  /** Unique in the company. Lowercase letters, numbers and dashes. */
  slug: string;
  kind: WorkspaceKind;
  isDefault: boolean;
  /** The workspace's own logo, or null. Show the company logo when it is null. */
  logoUrl: string | null;
  colors: WorkspaceColors;
  /** The brand's website, such as "https://example.com", or null. */
  website: string | null;
  archived: boolean;
}

/** Makes a slug from a name: "Acme Health (West)" gives "acme-health-west". */
export function workspaceSlug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "workspace";
}

/**
 * The workspace to show in a company, from the saved choice: a workspace id, "all", or null.
 * "all" is for owners and admins. A choice that is not an active workspace of the company gives its default workspace.
 * Returns "all", a workspace id, or null when the company has no workspaces (guests).
 */
export function pickWorkspace(company: Pick<Company, "role" | "workspaces">, saved: string | null | undefined): string | null {
  const list = company.workspaces ?? [];
  if (!list.length) return null;
  if (saved === ALL_WORKSPACES && (company.role === "owner" || company.role === "admin")) return ALL_WORKSPACES;
  return list.find((w) => w.id === saved)?.id ?? (list.find((w) => w.isDefault) ?? list[0]!).id;
}

/** True for a hex color such as "#1f2937" or "#fff". */
export const isHexColor = (v: string): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

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

/** Where an app keeps its data: for the whole company, or per workspace. From "scope" in the app's package.json. */
export type AppScope = "company" | "workspace";

export interface AppConfig {
  appName: string;
  /** The site logo that a super admin uploaded, or null for the OpenAct mark. */
  logoUrl: string | null;
  /** The Submit issues link that a super admin set, or null. The app rail shows its icon only when it is set. */
  issuesUrl: string | null;
  emailEnabled: boolean;
  signupMode: "open" | "invite";
  aiProvider: string;
  /** The installed apps, in order. "workspace" apps keep their data per workspace. Others are company-wide. */
  apps: Array<{ id: string; name: string; scope?: AppScope }>;
  /** What the sign-in page shows. A super admin sets it in Site settings. */
  signIn: SignInPage;
  /** True when AI agents can sign in with OAuth and use the apps' tools (AGENT_ACCESS is "on"). */
  agentAccess: boolean;
}

/** The sign-in page settings. Empty values use the defaults. */
export interface SignInPage {
  /** The heading beside the form. */
  heading: string;
  /** Who said the heading, or "" for no credit line. */
  credit: string;
  /** A link to the Terms of Use, or null. */
  termsUrl: string | null;
  /** A link to the Privacy Policy, or null. */
  privacyUrl: string | null;
  /** A URL for the background image, or null for the default stage. */
  backgroundUrl: string | null;
}
