import type { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import type { User } from "../shared/types";
import { COMPANY_ROLES } from "../shared/types";
import { PERMISSION_ID, permissionApp, type PermissionDef } from "../shared/permissions";

/*
 * Server side of an OpenAct app.
 *
 * The core owns sign-in, people, companies and roles. An app owns its own tables and routes,
 * and joins the core through the hooks below. The host lists the installed apps, and
 * createWorker() mounts them in that order.
 */

export interface ServerApp {
  /** A short, unique id in lowercase, such as "projects". Prefix your tables, routes and file keys with it. */
  id: string;
  name: string;
  /** Adds the app's API routes. New apps should use /api/apps/<id>/... */
  routes?: (api: Hono<AppEnv>) => void;
  /** Middleware that runs on every API request, after the session is read. */
  middleware?: MiddlewareHandler<AppEnv>[];
  /**
   * What people can do in the app, by company role. Ids start with the app id, such as "projects.create".
   * Check them in routes with requirePermission(). Company owners and admins can change the roles in Company settings.
   */
  permissions?: Record<string, PermissionDef>;
  /** Runs on each cron trigger. `cron` is the schedule that fired. */
  scheduled?: (env: Env, cron: string) => Promise<void>;
  hooks?: AppHooks;
}

export interface AppHooks {
  /** Return true to let this email sign up even when sign-up is limited, for example because of a pending invitation. */
  allowSignup?: (env: Env, email: string) => Promise<boolean>;
  /** Runs after a person signs in, before company invitations are applied. */
  signedIn?: (env: Env, user: User) => Promise<void>;
  /** Runs when a person leaves or is removed from a company. Remove their access to the app's data in it. */
  companyMemberRemoved?: (env: Env, companyId: string, userId: string) => Promise<void>;
  /** Runs before a company is deleted. Delete the app's data and files for it. */
  companyDeleting?: (env: Env, companyId: string) => Promise<void>;
  /** Extra fields for GET /api/companies/:id, such as the app's company settings. */
  companyDetail?: (env: Env, companyId: string) => Promise<Record<string, unknown>>;
  /** Handles the app's fields in PATCH /api/companies/:id. Return true when it changed something. */
  companyUpdate?: (env: Env, companyId: string, body: Record<string, unknown>) => Promise<boolean>;
  /** Settings for a new company, such as defaults. Runs after the company row exists. */
  companyCreated?: (env: Env, companyId: string, userId: string) => Promise<void>;
}

export function defineServerApp(app: ServerApp): ServerApp {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(app.id)) throw new Error(`App id "${app.id}" must be lowercase letters, numbers and dashes.`);
  for (const [id, def] of Object.entries(app.permissions ?? {})) {
    if (!PERMISSION_ID.test(id) || permissionApp(id) !== app.id) throw new Error(`Permission "${id}" must start with "${app.id}.", such as "${app.id}.edit".`);
    if (!def.label || !def.roles.every((r) => (COMPANY_ROLES as readonly string[]).includes(r)))
      throw new Error(`Permission "${id}" needs a label and roles from owner, admin, member and guest.`);
    if (def.roles.includes("guest") && !def.guests) throw new Error(`Permission "${id}" gives guests access. Set guests: true if that is safe.`);
  }
  return app;
}

let installed: ServerApp[] = [];

/** The installed apps, in order. createWorker() sets them. */
export function setApps(apps: ServerApp[]): void {
  const ids = new Set<string>();
  for (const a of apps) {
    if (ids.has(a.id)) throw new Error(`Two apps use the id "${a.id}".`);
    ids.add(a.id);
  }
  installed = apps;
}

export const getApps = (): readonly ServerApp[] => installed;

/** Runs a hook in every app that has it, in install order. */
export async function runHook<K extends keyof AppHooks>(
  name: K,
  ...args: Parameters<NonNullable<AppHooks[K]>>
): Promise<Array<Awaited<ReturnType<NonNullable<AppHooks[K]>>>>> {
  const out: Array<Awaited<ReturnType<NonNullable<AppHooks[K]>>>> = [];
  for (const app of installed) {
    const fn = app.hooks?.[name] as ((...a: unknown[]) => Promise<never>) | undefined;
    if (fn) out.push(await fn(...args));
  }
  return out;
}
