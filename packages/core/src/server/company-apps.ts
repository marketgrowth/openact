import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireCompanyRole } from "./data";
import { HttpError, nowIso, readJson, requireUser } from "./util";
import { getApps } from "./apps";
import { companyAccess, companyAppState, getCatalog, siteAppOff } from "./permissions";
import { COMPANY_ROLES } from "../shared/types";
import { allowedRoles, lockedRoles, permissionRolesProblem, type CompanyAppSettings } from "../shared/permissions";

/* Routes under /api/companies/:id: which apps are on, and who can do what in them. */

export const companyAppRoutes = new Hono<AppEnv>();

/** What the signed-in person can do in the company. Any member can read their own access. */
companyAppRoutes.get("/:id/access", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireCompanyRole(c.env, id, user.id, [...COMPANY_ROLES]);
  return c.json(await companyAccess(c.env, id, role));
});

/** Every installed app with its switch and its permissions, for Company settings. */
companyAppRoutes.get("/:id/apps", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const state = await companyAppState(c.env, id);
  const apps: CompanyAppSettings[] = getCatalog().map((info) => {
    const server = getApps().find((a) => a.id === info.id);
    return {
      id: info.id,
      name: info.name,
      enabled: state.enabled(info.id),
      enabledByDefault: info.enabledByDefault,
      siteOff: siteAppOff(info.id),
      permissions: Object.entries(server?.permissions ?? {}).map(([pid, def]) => ({
        id: pid,
        ...def,
        current: state.roles(pid),
        locked: lockedRoles(def),
        allowed: allowedRoles(def)
      }))
    };
  });
  return c.json({ apps });
});

/** Turns an app on or off, or changes the roles for its permissions. Body: { enabled?, permissions?: { "<id>": roles[] } } */
companyAppRoutes.patch("/:id/apps/:appId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const appId = c.req.param("appId");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const info = getCatalog().find((a) => a.id === appId);
  if (!info) throw new HttpError(404, "This app is not installed.");
  const body = await readJson(c);
  const row = await c.env.DB.prepare("SELECT enabled, permissions FROM company_apps WHERE company_id = ? AND app_id = ?")
    .bind(id, appId)
    .first<{ enabled: number; permissions: string }>();
  const state = await companyAppState(c.env, id);
  // The company's own choice. A super admin's site switch is separate, so it never overwrites this row.
  let enabled = row ? row.enabled === 1 : info.enabledByDefault;
  let chosen: Record<string, string[]> = {};
  try {
    chosen = JSON.parse(row?.permissions ?? "{}");
  } catch {
    chosen = {};
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "Enabled must be true or false.");
    if (body.enabled && siteAppOff(appId))
      throw new HttpError(400, `A super admin turned ${info.name} off for this site. Ask them to turn it on in Site settings first.`, "app_off");
    if (!body.enabled && enabled && getCatalog().filter((a) => a.id !== appId && state.enabled(a.id)).length === 0)
      throw new HttpError(400, "Keep at least one app on. Turn on another app first.");
    enabled = body.enabled;
  }
  if (body.permissions !== undefined) {
    if (!body.permissions || typeof body.permissions !== "object") throw new HttpError(400, "Permissions must be an object of permission ids and roles.");
    const declared = getApps().find((a) => a.id === appId)?.permissions ?? {};
    for (const [pid, roles] of Object.entries(body.permissions as Record<string, unknown>)) {
      const def = declared[pid];
      if (!def) throw new HttpError(400, `The ${info.name} app has no permission "${pid}".`);
      const problem = permissionRolesProblem(def, roles);
      if (problem) throw new HttpError(400, problem);
      chosen[pid] = roles as string[];
    }
  }
  await c.env.DB.prepare(
    `INSERT INTO company_apps (company_id, app_id, enabled, permissions, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, app_id) DO UPDATE SET enabled = excluded.enabled, permissions = excluded.permissions,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  )
    .bind(id, appId, enabled ? 1 : 0, JSON.stringify(chosen), user.id, nowIso())
    .run();
  return c.json({ ok: true });
});
