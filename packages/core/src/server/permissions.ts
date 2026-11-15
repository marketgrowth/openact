import type { Env } from "./env";
import { HttpError } from "./util";
import { companyRole } from "./data";
import { getApps } from "./apps";
import { siteState } from "./site-state";
import { companyPlan } from "./plans";
import { COMPANY_ROLES, type CompanyRole } from "../shared/types";
import { PLANS, planIncludes, type PaidPlan, type PlanId } from "../shared/plans";
import { permissionApp, rolesWithPermission, type CompanyAccess, type PermissionDef } from "../shared/permissions";

/*
 * Apps per company, and app permissions.
 *
 * The catalog lists every installed app, also apps that have only web code.
 * A super admin can turn an app off for the whole site. A company can turn an app off for itself.
 * An app that needs a plan, such as Docs with Director, is locked in a company without that plan.
 * A locked app is off: its routes, share links and live rooms stop, and its data stays.
 * Permissions come from each server app's `permissions`.
 */

export interface AppInfo {
  id: string;
  name: string;
  /** False for apps that a company must turn on first. */
  enabledByDefault: boolean;
  /** The plan the app needs, such as "director". Missing: the app is free. From "plan" in the app's package.json. */
  plan?: PaidPlan;
}

let catalog: AppInfo[] = [];

export function setCatalog(apps: AppInfo[]): void {
  catalog = apps;
}

/** Every installed app, in install order. */
export const getCatalog = (): readonly AppInfo[] => catalog;

/** The declaration of a permission, or undefined when no app declares it. */
export function permissionDef(permission: string): (PermissionDef & { appId: string }) | undefined {
  const app = getApps().find((a) => a.id === permissionApp(permission));
  const def = app?.permissions?.[permission];
  return def && { ...def, appId: app!.id };
}

/** The app settings of one company, read with one query. */
export interface CompanyAppState {
  /** The company's plan. */
  plan: PlanId;
  /** True when the app needs a plan that the company does not have. A locked app is off. */
  locked: (appId: string) => boolean;
  enabled: (appId: string) => boolean;
  /** The roles that have a permission in this company. */
  roles: (permission: string) => CompanyRole[];
}

/** The plan an installed app needs, or undefined when it is free. */
export const appPlan = (appId: string): PaidPlan | undefined => catalog.find((a) => a.id === appId)?.plan;

export async function companyAppState(env: Env, companyId: string): Promise<CompanyAppState> {
  const paid = catalog.some((a) => a.plan);
  const [rows, plan] = await Promise.all([
    env.DB.prepare("SELECT app_id, enabled, permissions FROM company_apps WHERE company_id = ?")
      .bind(companyId)
      .all<{ app_id: string; enabled: number; permissions: string }>(),
    // Read the plan only when an installed app needs one.
    paid ? companyPlan(env, companyId).then((p) => p.plan) : Promise.resolve<PlanId>("free")
  ]);
  const byApp = new Map(rows.results.map((r) => [r.app_id, r]));
  const locked = (appId: string) => !planIncludes(plan, appPlan(appId));
  return {
    plan,
    locked,
    enabled: (appId) => {
      if (siteAppOff(appId)) return false;
      if (locked(appId)) return false;
      const row = byApp.get(appId);
      if (row) return row.enabled === 1;
      return catalog.find((a) => a.id === appId)?.enabledByDefault ?? true;
    },
    roles: (permission) => {
      const def = permissionDef(permission);
      if (!def) throw new Error(`No installed app declares the permission "${permission}".`);
      let chosen: unknown;
      try {
        chosen = JSON.parse(byApp.get(def.appId)?.permissions ?? "{}")[permission];
      } catch {
        chosen = undefined;
      }
      return rolesWithPermission(def, Array.isArray(chosen) ? chosen : null);
    }
  };
}

/**
 * True when a super admin turned the app off for the whole site.
 * It reads the site settings that this isolate loaded last. siteMiddleware and the cron load them.
 * Routes outside /api/ must call loadSite() first.
 */
export function siteAppOff(appId: string): boolean {
  return !!siteState()?.appsOff.includes(appId);
}

const appName = (appId: string) => catalog.find((a) => a.id === appId)?.name ?? appId;

/** The error for an app that needs a plan the company does not have. */
export function planRequiredError(appId: string): HttpError {
  const plan = appPlan(appId) ?? "director";
  return new HttpError(
    403,
    `${appName(appId)} is part of ${PLANS[plan].name}. A company owner can upgrade on the Plan page, in Company settings.`,
    "plan_required"
  );
}

/**
 * The error for an app that is off in a company. Apps can throw it from their own access checks.
 * Pass the company's state to get the plan message for a locked app.
 */
export function appOffError(appId: string, state?: Pick<CompanyAppState, "locked">): HttpError {
  if (state?.locked(appId)) return planRequiredError(appId);
  if (siteAppOff(appId))
    return new HttpError(403, `The ${appName(appId)} app is off for this site. A super admin can turn it on in Site settings.`, "app_off");
  return new HttpError(403, `The ${appName(appId)} app is off for this company. A company owner or admin can turn it on in Company settings.`, "app_off");
}

/** Throws when the app is off in the company. */
export async function requireAppOn(env: Env, companyId: string, appId: string): Promise<void> {
  const state = await companyAppState(env, companyId);
  if (!state.enabled(appId)) throw appOffError(appId, state);
}

/**
 * Checks that the person is in the company, that the permission's app is on, and that their role has the permission.
 * Returns their company role. Use it in every app route that reads or changes company data.
 */
export async function requirePermission(env: Env, companyId: string, userId: string, permission: string): Promise<CompanyRole> {
  const def = permissionDef(permission);
  if (!def) throw new Error(`No installed app declares the permission "${permission}".`);
  const [role, state] = await Promise.all([companyRole(env, companyId, userId), companyAppState(env, companyId)]);
  if (!role) throw new HttpError(404, "This company does not exist, or you are not in it.");
  if (!state.enabled(def.appId)) throw appOffError(def.appId, state);
  if (!state.roles(permission).includes(role)) {
    throw new HttpError(
      403,
      `Your role in this company does not allow this: ${def.label}. Ask a company owner or admin to change it in Company settings.`,
      "no_permission"
    );
  }
  return role;
}

/** True when the person has the permission. Never throws for a missing company or an app that is off. */
export async function hasPermission(env: Env, companyId: string, userId: string, permission: string): Promise<boolean> {
  try {
    await requirePermission(env, companyId, userId, permission);
    return true;
  } catch (e) {
    if (e instanceof HttpError) return false;
    throw e;
  }
}

/** What one person can do in a company, for the web app. */
export async function companyAccess(env: Env, companyId: string, role: CompanyRole): Promise<CompanyAccess> {
  const state = await companyAppState(env, companyId);
  const disabledApps = catalog.filter((a) => !state.enabled(a.id)).map((a) => a.id);
  const lockedApps = catalog.filter((a) => state.locked(a.id)).map((a) => a.id);
  const permissions: string[] = [];
  for (const app of getApps()) {
    if (!state.enabled(app.id)) continue;
    for (const id of Object.keys(app.permissions ?? {})) if (state.roles(id).includes(role)) permissions.push(id);
  }
  return { role, plan: state.plan, disabledApps, lockedApps, permissions };
}

export const isCompanyRole = (r: unknown): r is CompanyRole => (COMPANY_ROLES as readonly unknown[]).includes(r);
