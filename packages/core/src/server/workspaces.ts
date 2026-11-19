import { Hono, type Context } from "hono";
import type { AppEnv } from "./env";
import { ALL_WORKSPACES, COMPANY_ROLES } from "../shared/types";
import { companyRole, requireCompanyRole } from "./data";
import { getCatalog } from "./permissions";
import { HttpError, nowIso, readJson, requireUser } from "./util";
import {
  createWorkspace,
  defaultWorkspaceId,
  getWorkspace,
  isManager,
  listWorkspaces,
  resolveWorkspace,
  updateWorkspace,
  type WorkspaceInput
} from "./workspace-store";

export {
  createWorkspace,
  defaultWorkspaceId,
  getWorkspace,
  listWorkspaces,
  requireActiveWorkspace,
  resolveWorkspace,
  updateWorkspace,
  type WorkspaceInput
} from "./workspace-store";

/*
 * Workspaces: named slices of a company's work, such as brands, business units, locations or regions.
 *
 * Rules:
 * - Every company has one default workspace. A trigger in 0013_workspaces.sql makes it with the company.
 * - Workspaces are flat. They use the company roles. Owners and admins manage them.
 * - Workspaces are archived, never deleted. The default workspace cannot be archived.
 * - Apps with "scope": "workspace" keep a workspace_id on their rows. They read it with workspaceScope().
 *   Other apps never see a workspace and stay company-wide.
 * - Workspaces organize work. They do not limit access: a person who can open a project or doc in one
 *   workspace can open it from a link in any workspace. Guests always see every workspace they are invited to.
 */

export const workspaceRoutes = new Hono<AppEnv>();

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_LOGO_BYTES = 1024 * 1024;

/** True when the installed app declares "scope": "workspace" in its manifest. */
export const isWorkspaceApp = (appId: string): boolean => getCatalog().find((a) => a.id === appId)?.scope === "workspace";

/**
 * For workspace-aware apps: the workspace this request works in, or null for every workspace.
 * It reads ?workspace=<id|all> or the X-OpenAct-Workspace header, then the person's saved choice.
 * An app without "scope": "workspace" always gets null, so it stays company-wide.
 * Check the company role or permission first. This never decides access.
 */
export async function workspaceScope(c: Context<AppEnv>, appId: string, companyId: string): Promise<string | null> {
  if (!isWorkspaceApp(appId)) return null;
  const user = requireUser(c);
  const role = await companyRole(c.env, companyId, user.id);
  const wanted = c.req.query("workspace") ?? c.req.header("x-openact-workspace") ?? undefined;
  return resolveWorkspace(c.env, { companyId, userId: user.id, role, wanted });
}

/**
 * For workspace-aware apps: the workspace a new row goes in. `wanted` is an id from the request body, if any.
 * In the All workspaces view, new rows go to the default workspace. Returns null for company-wide apps.
 */
export async function workspaceForNew(c: Context<AppEnv>, appId: string, companyId: string, wanted?: unknown): Promise<string | null> {
  if (!isWorkspaceApp(appId)) return null;
  if (typeof wanted === "string" && wanted && wanted !== ALL_WORKSPACES) {
    const ws = await getWorkspace(c.env, companyId, wanted);
    if (!ws || ws.archived) throw new HttpError(400, "This workspace does not exist, or it was archived. Pick another workspace.");
    return ws.id;
  }
  return (await workspaceScope(c, appId, companyId)) ?? (await defaultWorkspaceId(c.env, companyId));
}

/* Routes, under /api/companies. */

/** The company's workspaces. Owners and admins can add ?archived=1. Guests get an empty list. */
workspaceRoutes.get("/:id/workspaces", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireCompanyRole(c.env, id, user.id, [...COMPANY_ROLES]);
  if (role === "guest") return c.json({ workspaces: [] });
  const archived = c.req.query("archived") === "1" && isManager(role);
  return c.json({ workspaces: (await listWorkspaces(c.env, [id], { archived })).get(id) ?? [] });
});

workspaceRoutes.post("/:id/workspaces", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const workspace = await createWorkspace(c.env, id, user.id, (await readJson(c)) as WorkspaceInput);
  return c.json({ workspace }, 201);
});

workspaceRoutes.patch("/:id/workspaces/:wid", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const workspace = await updateWorkspace(c.env, id, c.req.param("wid"), (await readJson(c)) as WorkspaceInput);
  return c.json({ workspace });
});

/** Remembers the workspace the person works in: an id, or "all" for owners and admins. It also makes the company current. */
workspaceRoutes.post("/:id/workspaces/:wid/switch", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const wid = c.req.param("wid");
  const role = await requireCompanyRole(c.env, id, user.id, ["owner", "admin", "member"]);
  if (wid === ALL_WORKSPACES) {
    if (!isManager(role)) throw new HttpError(403, "Only company owners and admins can see all workspaces at once.");
  } else {
    const ws = await getWorkspace(c.env, id, wid);
    if (!ws || ws.archived) throw new HttpError(404, "This workspace does not exist, or it was archived. Pick another workspace.");
  }
  await c.env.DB.prepare("UPDATE users SET current_company_id = ?, current_workspace_id = ? WHERE id = ?").bind(id, wid, user.id).run();
  return c.json({ currentWorkspaceId: wid });
});

/* Logo. Without one, the web app shows the company logo. */

workspaceRoutes.get("/:id/workspaces/:wid/logo", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, [...COMPANY_ROLES]);
  const row = await c.env.DB.prepare("SELECT logo_key, logo_type FROM workspaces WHERE id = ? AND company_id = ?")
    .bind(c.req.param("wid"), id)
    .first<{ logo_key: string | null; logo_type: string | null }>();
  if (!row?.logo_key) throw new HttpError(404, "This workspace has no logo.");
  const obj = await c.env.FILES.get(row.logo_key);
  if (!obj) throw new HttpError(404, "The logo file is missing. Upload it again.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.logo_type || "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
});

workspaceRoutes.put("/:id/workspaces/:wid/logo", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const wid = c.req.param("wid");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  if (!(await getWorkspace(c.env, id, wid))) throw new HttpError(404, "This workspace does not exist. It may have been removed.");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Choose an image file.");
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new HttpError(400, "Use a PNG, JPEG or WebP image.");
  if (file.size > MAX_LOGO_BYTES) throw new HttpError(400, "The logo must be 1 MB or smaller.");
  // Under companies/<id>/, so deleting the company deletes the logo too.
  const key = `companies/${id}/workspaces/${wid}/logo`;
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const iso = nowIso();
  await c.env.DB.prepare("UPDATE workspaces SET logo_key = ?, logo_type = ?, logo_updated_at = ?, updated_at = ? WHERE id = ? AND company_id = ?")
    .bind(key, file.type, iso, iso, wid, id)
    .run();
  return c.json({ workspace: await getWorkspace(c.env, id, wid) });
});

workspaceRoutes.delete("/:id/workspaces/:wid/logo", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const wid = c.req.param("wid");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  await c.env.FILES.delete(`companies/${id}/workspaces/${wid}/logo`);
  await c.env.DB.prepare("UPDATE workspaces SET logo_key = NULL, logo_type = NULL, logo_updated_at = NULL, updated_at = ? WHERE id = ? AND company_id = ?")
    .bind(nowIso(), wid, id)
    .run();
  return c.json({ workspace: await getWorkspace(c.env, id, wid) });
});
