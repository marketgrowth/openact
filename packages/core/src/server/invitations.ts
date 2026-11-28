import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { COMPANY_ROLE_LABELS, type CompanyRole } from "../shared/types";
import { INVITE_DAILY_LIMIT, INVITE_DAYS, type InvitationLevel, type PendingInvitation } from "../shared/invitations";
import { runHook } from "./apps";
import { companyInviteEmail, sendEmail } from "./email";
import { HttpError, appName, newId, nowIso, requireUser } from "./util";

/*
 * Invitations: a person has to accept before they join.
 * Levels: site (the super owner invites a client company), company (an owner or admin), workspace (phase 3).
 * docs/invitations.md has the rules.
 */

export const invitationRoutes = new Hono<AppEnv>();

/** Stops a person or company from sending too many invitations in a day. */
export async function assertInviteBudget(env: Env, scope: { companyId: string } | { invitedBy: string; level: "site" }): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const row =
    "companyId" in scope
      ? await env.DB.prepare("SELECT COUNT(*) AS n FROM invitation_log WHERE company_id = ? AND created_at > ?").bind(scope.companyId, since).first<{ n: number }>()
      : await env.DB.prepare("SELECT COUNT(*) AS n FROM invitation_log WHERE invited_by = ? AND level = 'site' AND created_at > ?")
          .bind(scope.invitedBy, since)
          .first<{ n: number }>();
  if ((row?.n ?? 0) >= INVITE_DAILY_LIMIT)
    throw new HttpError(429, `You sent ${INVITE_DAILY_LIMIT} invitations today, which is the limit. Try again tomorrow.`);
}

/** Saves an invitation (a second one for the same email replaces the first) and logs it. */
export async function saveInvitation(
  env: Env,
  o: { companyId: string; email: string; role: Exclude<CompanyRole, "guest">; level: InvitationLevel; workspaceId: string | null; invitedBy: string }
): Promise<void> {
  const iso = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO company_invitations (id, company_id, email, role, level, workspace_id, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id, email) DO UPDATE SET role = excluded.role, level = excluded.level, workspace_id = excluded.workspace_id,
         invited_by = excluded.invited_by, created_at = excluded.created_at, expires_at = excluded.expires_at`
    ).bind(newId(), o.companyId, o.email, o.role, o.level, o.workspaceId, o.invitedBy, iso, new Date(Date.now() + INVITE_DAYS * 86400000).toISOString()),
    env.DB.prepare("INSERT INTO invitation_log (id, company_id, invited_by, level, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      newId(),
      o.companyId,
      o.invitedBy,
      o.level,
      iso
    )
  ]);
}

/** Emails the invitation. The subject is fixed text, so the company name cannot be used to send spam. */
export function mailInvitation(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void },
  o: { to: string; companyName: string; inviterName: string; role: CompanyRole; url: string }
): void {
  ctx.waitUntil(
    sendEmail(env, companyInviteEmail(env, { ...o, role: COMPANY_ROLE_LABELS[o.role], siteName: appName(env) })).catch((e) =>
      console.error("[openact] invitation email failed", e)
    )
  );
}

interface Row {
  id: string;
  company_id: string;
  company_name: string;
  role: CompanyRole;
  level: InvitationLevel;
  workspace_name: string | null;
  inviter_name: string | null;
  expires_at: string;
}

/** Invitations for this email that have not expired. */
export async function pendingInvitations(env: Env, email: string): Promise<PendingInvitation[]> {
  const res = await env.DB.prepare(
    `SELECT i.id, i.company_id, co.name AS company_name, i.role, i.level, w.name AS workspace_name, u.name AS inviter_name, i.expires_at
     FROM company_invitations i
     JOIN companies co ON co.id = i.company_id
     LEFT JOIN workspaces w ON w.id = i.workspace_id
     LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.email = ? AND i.expires_at > ?
     ORDER BY i.created_at`
  )
    .bind(email, nowIso())
    .all<Row>();
  return res.results.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    role: r.role,
    level: r.level,
    workspaceName: r.workspace_name,
    inviterName: r.inviter_name,
    expiresAt: r.expires_at
  }));
}

invitationRoutes.get("/", async (c) => {
  const user = requireUser(c);
  return c.json({ invitations: await pendingInvitations(c.env, user.email) });
});

async function mine(env: Env, id: string, email: string) {
  const inv = await env.DB.prepare("SELECT id, company_id, role, level, workspace_id, expires_at FROM company_invitations WHERE id = ? AND email = ?")
    .bind(id, email)
    .first<{ id: string; company_id: string; role: CompanyRole; level: InvitationLevel; workspace_id: string | null; expires_at: string }>();
  // Someone else's invitation looks the same as one that does not exist.
  if (!inv) throw new HttpError(404, "This invitation does not exist.");
  if (inv.expires_at <= nowIso()) throw new HttpError(410, "This invitation has expired. Ask for a new one.");
  return inv;
}

/** The person joins the company. One batch writes the member row and removes the invitation. */
invitationRoutes.post("/:id/accept", async (c) => {
  const user = requireUser(c);
  const inv = await mine(c.env, c.req.param("id"), user.email);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (company_id, user_id) DO UPDATE SET role = CASE
         WHEN company_members.role = 'guest' THEN excluded.role
         WHEN excluded.role = 'owner' OR (excluded.role = 'admin' AND company_members.role = 'member') THEN excluded.role
         ELSE company_members.role END`
    ).bind(inv.company_id, user.id, inv.role, nowIso()),
    // A member starts in the workspace they were invited to, or in the default one.
    ...(inv.role === "member"
      ? [
          c.env.DB.prepare(
            `INSERT OR IGNORE INTO workspace_members (workspace_id, company_id, user_id, created_at)
             SELECT COALESCE(?, (SELECT id FROM workspaces WHERE company_id = ? AND is_default = 1)), ?, ?, ?`
          ).bind(inv.workspace_id, inv.company_id, inv.company_id, user.id, nowIso())
        ]
      : []),
    c.env.DB.prepare("DELETE FROM company_invitations WHERE id = ?").bind(inv.id),
    c.env.DB.prepare("UPDATE users SET current_company_id = ? WHERE id = ? AND current_company_id IS NULL").bind(inv.company_id, user.id)
  ]);
  // A site invitation made an empty company. Apps set it up now that it has an owner.
  if (inv.level === "site") await runHook("companyCreated", c.env, inv.company_id, user.id);
  return c.json({ ok: true, companyId: inv.company_id });
});

invitationRoutes.post("/:id/decline", async (c) => {
  const user = requireUser(c);
  const inv = await mine(c.env, c.req.param("id"), user.email);
  await c.env.DB.prepare("DELETE FROM company_invitations WHERE id = ?").bind(inv.id).run();
  // A site invitation made the company. Declined, it has no people, so it goes.
  if (inv.level === "site")
    await c.env.DB.prepare("DELETE FROM companies WHERE id = ? AND NOT EXISTS (SELECT 1 FROM company_members WHERE company_id = ?)")
      .bind(inv.company_id, inv.company_id)
      .run();
  return c.json({ ok: true });
});
