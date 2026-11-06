/*
 * App permissions. Pure module, used by the Worker, the web app and tests.
 *
 * An app declares each permission with a label and the company roles that have it by default.
 * A company owner or admin can change the roles in Company settings. Some rules never change:
 *   - The company owner always has every permission.
 *   - Roles in `locked` always have the permission.
 *   - Guests never get a permission unless the app sets `guests: true`. Guests see only what someone shares with them.
 */
import { COMPANY_ROLES, type CompanyRole } from "./types.ts";

export interface PermissionDef {
  /** A short label for Company settings, such as "Create projects". */
  label: string;
  /** One sentence that says what the permission allows. */
  description?: string;
  /** The roles that have the permission when the company has not changed it. */
  roles: CompanyRole[];
  /** Roles that always have the permission. The owner is always one of them. */
  locked?: CompanyRole[];
  /** True when guests may get the permission. Use it only for actions that are safe for people outside the company. */
  guests?: boolean;
}

/** Permission ids look like "<app id>.<action>", such as "projects.create". */
export const PERMISSION_ID = /^[a-z][a-z0-9-]{1,30}\.[a-z][a-z0-9.-]{0,60}$/;

/** The app that owns a permission. */
export const permissionApp = (permission: string): string => permission.slice(0, permission.indexOf("."));

/** The roles that cannot lose this permission. */
export function lockedRoles(def: PermissionDef): CompanyRole[] {
  const locked = new Set<CompanyRole>(["owner", ...(def.locked ?? [])]);
  return COMPANY_ROLES.filter((r) => locked.has(r));
}

/** The roles that may have this permission at all. */
export function allowedRoles(def: PermissionDef): CompanyRole[] {
  return COMPANY_ROLES.filter((r) => r !== "guest" || def.guests);
}

/** The roles that have the permission in one company: the company's choice, or the app's default, with the fixed rules applied. */
export function rolesWithPermission(def: PermissionDef, chosen?: readonly string[] | null): CompanyRole[] {
  const set = new Set<string>(chosen ?? def.roles);
  for (const r of lockedRoles(def)) set.add(r);
  const allowed = allowedRoles(def);
  return allowed.filter((r) => set.has(r));
}

/** Checks the roles that a company chose for a permission. Returns an error message, or null when they are fine. */
export function permissionRolesProblem(def: PermissionDef, roles: unknown): string | null {
  if (!Array.isArray(roles) || roles.some((r) => typeof r !== "string" || !(COMPANY_ROLES as readonly string[]).includes(r)))
    return `Roles for "${def.label}" must be a list of owner, admin, member or guest.`;
  if (roles.includes("guest") && !def.guests) return `Guests cannot get "${def.label}". Guests see only what someone shares with them.`;
  return null;
}

/** What one person can do in their current company. GET /api/companies/:id/access */
export interface CompanyAccess {
  role: CompanyRole;
  /** Apps that are off in this company. Apps that are not listed are on. */
  disabledApps: string[];
  /** The permissions this person has in this company. */
  permissions: string[];
}

/** One app in Company settings. GET /api/companies/:id/apps */
export interface CompanyAppSettings {
  id: string;
  name: string;
  enabled: boolean;
  enabledByDefault: boolean;
  permissions: Array<PermissionDef & { id: string; current: CompanyRole[]; locked: CompanyRole[]; allowed: CompanyRole[] }>;
}
