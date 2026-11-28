import { Hono, type Context } from "hono";
import type { AppEnv } from "./env";
import { ALL_WORKSPACES, COMPANY_ROLES } from "../shared/types";
import { companyRole, requireCompanyRole } from "./data";
import { getCatalog } from "./permissions";
import { HttpError, appName, appUrl, isEmail, normalizeEmail, nowIso, readJson, requireUser } from "./util";
import { assertInviteBudget, mailInvitation, saveInvitation } from "./invitations";
import { sendEmail, workspaceAddedEmail } from "./email";
import {
  createWorkspace,
  defaultWorkspaceId,
  getWorkspace,
  addWorkspaceMember,
  isManager,
  listWorkspaces,
  memberWorkspaceIds,
  requireActiveWorkspace,
  resolveWorkspace,
  updateWorkspace,
  type WorkspaceInput
} from "./workspace-store";

export {
  addWorkspaceMember,
  createWorkspace,
  defaultWorkspaceId,
  getWorkspace,
  listWorkspaces,
  memberWorkspaceIds,
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
 * - Workspaces limit what a member sees. A member works only in the workspaces in workspace_members.
 *   Owners and admins see every workspace. Guests see what they are invited to, in every workspace.
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
    const user = requireUser(c);
    return requireActiveWorkspace(c.env, companyId, wanted, { userId: user.id, role: await companyRole(c.env, companyId, user.id) });
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
  const forUser = { userId: user.id, roles: new Map([[id, role]]) };
  return c.json({ workspaces: (await listWorkspaces(c.env, [id], { archived, forUser })).get(id) ?? [] });
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
    // A member can switch only to a workspace they are in.
    if (!isManager(role) && !(await memberWorkspaceIds(c.env, id, user.id)).includes(wid))
      throw new HttpError(404, "This workspace does not exist, or you are not in it. Pick another workspace.");
  }
  await c.env.DB.prepare("UPDATE users SET current_company_id = ?, current_workspace_id = ? WHERE id = ?").bind(id, wid, user.id).run();
  return c.json({ currentWorkspaceId: wid });
});

/* People. Who works in a workspace. */

/** Owners, admins and the workspace's own members open this. Anyone else gets 404. */
async function requireWorkspaceAccess(c: Context<AppEnv>, companyId: string, workspaceId: string) {
  const user = requireUser(c);
  const role = await requireCompanyRole(c.env, companyId, user.id, ["owner", "admin", "member"]);
  const ws = await getWorkspace(c.env, companyId, workspaceId);
  const inside = isManager(role) || (await memberWorkspaceIds(c.env, companyId, user.id)).includes(workspaceId);
  if (!ws || !inside) throw new HttpError(404, "This workspace does not exist, or you are not in it.");
  return { user, role, ws };
}

/** The people in a workspace. Owners and admins are in every workspace, so they are not listed here. */
workspaceRoutes.get("/:id/workspaces/:wid/members", async (c) => {
  const id = c.req.param("id");
  const { ws } = await requireWorkspaceAccess(c, id, c.req.param("wid"));
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = ? ORDER BY u.name COLLATE NOCASE`
  )
    .bind(ws.id)
    .all<{ id: string; name: string; email: string }>();
  return c.json({ members: rows.results });
});

/** Owners and admins add a company member to a workspace. Body: { userId } */
workspaceRoutes.post("/:id/workspaces/:wid/members", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const ws = await getWorkspace(c.env, id, c.req.param("wid"));
  if (!ws || ws.archived) throw new HttpError(404, "This workspace does not exist, or it was archived.");
  const userId = String((await readJson(c)).userId ?? "");
  if ((await companyRole(c.env, id, userId)) !== "member") throw new HttpError(400, "Pick a member of this company. Owners and admins are in every workspace already.");
  await addWorkspaceMember(c.env, id, ws.id, userId).run();
  return c.json({ ok: true }, 201);
});

/** Owners and admins take a member out of a workspace. A member can take themselves out. */
workspaceRoutes.delete("/:id/workspaces/:wid/members/:userId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const target = c.req.param("userId");
  await requireCompanyRole(c.env, id, user.id, target === user.id ? ["owner", "admin", "member"] : ["owner", "admin"]);
  const res = await c.env.DB.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND company_id = ? AND user_id = ?")
    .bind(c.req.param("wid"), id, target)
    .run();
  if (!res.meta.changes) throw new HttpError(404, "This person is not in the workspace.");
  return c.json({ ok: true });
});

/**
 * A person in the workspace invites someone by email. Body: { email }
 * The role is always member. Someone in the company joins the workspace now and gets a notice.
 * Someone new gets an invitation, and joins the company and the workspace when they accept.
 * The reply is the same for both. A company can turn this off for members.
 */
workspaceRoutes.post("/:id/workspaces/:wid/invite", async (c) => {
  const id = c.req.param("id");
  const { user, role, ws } = await requireWorkspaceAccess(c, id, c.req.param("wid"));
  if (ws.archived) throw new HttpError(400, "This workspace was archived.");
  const co = await c.env.DB.prepare("SELECT name, member_invites FROM companies WHERE id = ?").bind(id).first<{ name: string; member_invites: number }>();
  if (!isManager(role) && co!.member_invites !== 1) throw new HttpError(403, "This company lets only owners and admins invite people.");
  const email = normalizeEmail((await readJson(c)).email);
  if (!isEmail(email)) throw new HttpError(400, "Type a valid email address.");
  await assertInviteBudget(c.env, { companyId: id });
  const target = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const current = target ? await companyRole(c.env, id, target.id) : null;
  if (target && current && current !== "guest") {
    // Already in the company. A member joins the workspace at once. An owner or admin is in every workspace.
    if (current === "member") await addWorkspaceMember(c.env, id, ws.id, target.id).run();
    c.executionCtx.waitUntil(
      sendEmail(c.env, workspaceAddedEmail(c.env, { to: email, workspaceName: ws.name, companyName: co!.name, inviterName: user.name, url: `${appUrl(c)}/?company=${id}`, siteName: appName(c.env) })).catch((e) =>
        console.error("[openact] workspace notice failed", e)
      )
    );
  } else {
    // New to the company. Only an owner or admin invitation opens sign-up when SIGNUP_MODE is invite.
    await saveInvitation(c.env, { companyId: id, email, role: "member", level: isManager(role) ? "company" : "workspace", workspaceId: ws.id, invitedBy: user.id });
    mailInvitation(c.env, c.executionCtx, { to: email, companyName: co!.name, inviterName: user.name, role: "member", url: `${appUrl(c)}/?company=${id}` });
  }
  return c.json({ ok: true }, 201);
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
