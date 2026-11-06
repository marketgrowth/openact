import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import {
  AGENT_LEVELS,
  AGENT_SCOPES,
  COMPANY_ROLES,
  COMPANY_ROLE_LABELS,
  ROLES,
  type AgentLevel,
  type AiPolicy,
  type Company,
  type CompanyDetail,
  type CompanyRole,
  type User
} from "../shared/types";
import { ROLE_CEILING, levelRank, parsePolicy } from "../shared/agent-policy";
import { emailDomainProblem } from "../shared/access";
import { companyRole, deletePrefix, requireCompanyRole } from "./data";
import { companyInviteEmail, sendEmail } from "./email";
import { HttpError, appUrl, isEmail, newId, normalizeEmail, nowIso, oneOf, readJson, requireUser, text } from "./util";

export const companyRoutes = new Hono<AppEnv>();

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_COMPANIES_PER_PERSON = 20;

type CompanyRow = { id: string; name: string; role: CompanyRole; logo_key: string | null; logo_updated_at: string | null };

const logoUrl = (r: { id: string; logo_key: string | null; logo_updated_at: string | null }) =>
  r.logo_key ? `/api/companies/${r.id}/logo?v=${encodeURIComponent(r.logo_updated_at ?? "")}` : null;

const toCompany = (r: CompanyRow): Company => ({ id: r.id, name: r.name, role: r.role, logoUrl: logoUrl(r) });

export async function listCompanies(env: Env, userId: string): Promise<Company[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.logo_key, c.logo_updated_at, m.role
     FROM companies c JOIN company_members m ON m.company_id = c.id AND m.user_id = ?
     ORDER BY c.name COLLATE NOCASE`
  )
    .bind(userId)
    .all<CompanyRow>();
  return rows.results.map(toCompany);
}

/** The company the person last used, or their first one. */
export async function currentCompanyId(env: Env, userId: string, companies?: Company[]): Promise<string | null> {
  const list = companies ?? (await listCompanies(env, userId));
  const row = await env.DB.prepare("SELECT current_company_id FROM users WHERE id = ?").bind(userId).first<{ current_company_id: string | null }>();
  const found = list.find((c) => c.id === row?.current_company_id);
  return found?.id ?? list[0]?.id ?? null;
}

async function ownerCount(env: Env, companyId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM company_members WHERE company_id = ? AND role = 'owner'").bind(companyId).first<{ n: number }>();
  return row?.n ?? 0;
}

function readAiDefaults(body: Record<string, unknown>, current: AiPolicy): AiPolicy {
  const policy = { ...current };
  for (const role of ROLES) {
    if (body[role] === undefined) continue;
    const level = oneOf(body[role], `Level for ${role}`, AGENT_LEVELS) as AgentLevel;
    if (levelRank(level) > levelRank(ROLE_CEILING[role])) throw new HttpError(400, `The ${role} role allows the agent up to "${ROLE_CEILING[role]}". Choose that level or a lower one.`);
    policy[role] = level;
  }
  if (body.scope !== undefined) policy.scope = oneOf(body.scope, "Topic scope", AGENT_SCOPES);
  if (body.readNotes !== undefined) {
    if (typeof body.readNotes !== "boolean") throw new HttpError(400, "Note search must be true or false.");
    policy.readNotes = body.readNotes;
  }
  return policy;
}

companyRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const companies = await listCompanies(c.env, user.id);
  return c.json({ companies, currentId: await currentCompanyId(c.env, user.id, companies) });
});

companyRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const name = text(body.name, "Company name", { max: 80, required: true });
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM company_members WHERE user_id = ? AND role = 'owner'").bind(user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_COMPANIES_PER_PERSON) throw new HttpError(400, `You own ${MAX_COMPANIES_PER_PERSON} companies, which is the limit. Delete one first.`);
  const id = newId();
  const iso = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO companies (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, name, user.id, iso, iso),
    c.env.DB.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, iso),
    c.env.DB.prepare("UPDATE users SET current_company_id = ? WHERE id = ?").bind(id, user.id)
  ]);
  const company: Company = { id, name, role: "owner", logoUrl: null };
  return c.json({ company }, 201);
});

/** Remembers the company that the person works in. */
companyRoutes.post("/:id/switch", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, [...COMPANY_ROLES]);
  await c.env.DB.prepare("UPDATE users SET current_company_id = ? WHERE id = ?").bind(id, user.id).run();
  return c.json({ currentId: id });
});

companyRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const [co, members, invites] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, name, logo_key, logo_updated_at, email_domain, ai_defaults FROM companies WHERE id = ?").bind(id),
    c.env.DB.prepare(
      "SELECT u.id AS user_id, u.email, u.name, m.role FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name COLLATE NOCASE"
    ).bind(id),
    c.env.DB.prepare("SELECT id, email, role, created_at FROM company_invitations WHERE company_id = ? ORDER BY created_at").bind(id)
  ]);
  const r = co.results[0] as { id: string; name: string; logo_key: string | null; logo_updated_at: string | null; email_domain: string | null; ai_defaults: string };
  const detail: CompanyDetail = {
    id: r.id,
    name: r.name,
    role,
    logoUrl: logoUrl(r),
    emailDomain: r.email_domain,
    aiDefaults: parsePolicy(r.ai_defaults),
    members: (members.results as Array<{ user_id: string; email: string; name: string; role: CompanyRole }>).map((m) => ({ userId: m.user_id, email: m.email, name: m.name, role: m.role })),
    invitations: (invites.results as Array<{ id: string; email: string; role: CompanyRole; created_at: string }>).map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at }))
  };
  return c.json(detail);
});

companyRoutes.patch("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const body = await readJson(c);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    sets.push("name = ?");
    vals.push(text(body.name, "Company name", { max: 80, required: true }));
  }
  if (body.emailDomain !== undefined) {
    if (body.emailDomain === null || body.emailDomain === "") {
      sets.push("email_domain = NULL");
    } else {
      const domain = text(body.emailDomain, "Email domain", { max: 253, required: true }).toLowerCase().replace(/^@/, "");
      const problem = emailDomainProblem(domain, user.email);
      if (problem) throw new HttpError(400, problem);
      const taken = await c.env.DB.prepare("SELECT id FROM companies WHERE email_domain = ? AND id != ?").bind(domain, id).first();
      if (taken) throw new HttpError(409, `Another company already uses ${domain} for auto-join.`);
      sets.push("email_domain = ?");
      vals.push(domain);
    }
  }
  if (body.aiDefaults !== undefined) {
    if (!body.aiDefaults || typeof body.aiDefaults !== "object") throw new HttpError(400, "AI defaults must be an object.");
    const row = await c.env.DB.prepare("SELECT ai_defaults FROM companies WHERE id = ?").bind(id).first<{ ai_defaults: string }>();
    sets.push("ai_defaults = ?");
    vals.push(JSON.stringify(readAiDefaults(body.aiDefaults as Record<string, unknown>, parsePolicy(row?.ai_defaults))));
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change.");
  sets.push("updated_at = ?");
  vals.push(nowIso());
  await c.env.DB.prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ ok: true });
});

companyRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const projects = await c.env.DB.prepare("SELECT id FROM projects WHERE company_id = ?").bind(id).all<{ id: string }>();
  for (const p of projects.results) await deletePrefix(c.env.FILES, `projects/${p.id}/`);
  await deletePrefix(c.env.FILES, `companies/${id}/`);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM projects WHERE company_id = ?").bind(id),
    c.env.DB.prepare("UPDATE users SET current_company_id = NULL WHERE current_company_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(id)
  ]);
  return c.json({ ok: true });
});

/* Logo */

companyRoutes.get("/:id/logo", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, [...COMPANY_ROLES]);
  const row = await c.env.DB.prepare("SELECT logo_key, logo_type FROM companies WHERE id = ?").bind(id).first<{ logo_key: string | null; logo_type: string | null }>();
  if (!row?.logo_key) throw new HttpError(404, "This company has no logo.");
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

companyRoutes.put("/:id/logo", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Choose an image file.");
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new HttpError(400, "Use a PNG, JPEG or WebP image.");
  if (file.size > MAX_LOGO_BYTES) throw new HttpError(400, "The logo must be 1 MB or smaller.");
  const key = `companies/${id}/logo`;
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const iso = nowIso();
  await c.env.DB.prepare("UPDATE companies SET logo_key = ?, logo_type = ?, logo_updated_at = ?, updated_at = ? WHERE id = ?").bind(key, file.type, iso, iso, id).run();
  return c.json({ logoUrl: logoUrl({ id, logo_key: key, logo_updated_at: iso }) });
});

companyRoutes.delete("/:id/logo", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  await c.env.FILES.delete(`companies/${id}/logo`);
  await c.env.DB.prepare("UPDATE companies SET logo_key = NULL, logo_type = NULL, logo_updated_at = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), id).run();
  return c.json({ ok: true });
});

/* People */

companyRoutes.post("/:id/members", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const actorRole = await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) throw new HttpError(400, "Type a valid email address.");
  const role = body.role === undefined ? "member" : oneOf(body.role, "Role", ["admin", "member"] as const);
  if (role === "admin" && actorRole !== "owner" && actorRole !== "admin") throw new HttpError(403, "Only company owners and admins can add admins.");
  const co = await c.env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(id).first<{ name: string }>();
  const url = `${appUrl(c)}/?company=${id}`;
  const iso = nowIso();
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (existing) {
    const current = await companyRole(c.env, id, existing.id);
    if (current && current !== "guest") throw new HttpError(409, "This person is already in the company.");
    // A guest becomes a member or admin.
    await c.env.DB.prepare(
      "INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (company_id, user_id) DO UPDATE SET role = excluded.role"
    )
      .bind(id, existing.id, role, iso)
      .run();
    c.executionCtx.waitUntil(
      sendEmail(c.env, companyInviteEmail(c.env, { to: email, companyName: co!.name, inviterName: user.name, role: COMPANY_ROLE_LABELS[role], url, hasAccount: true })).catch((e) =>
        console.error("[openact] company invite email failed", e)
      )
    );
    return c.json({ added: "member" }, 201);
  }
  await c.env.DB.prepare(
    `INSERT INTO company_invitations (id, company_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, created_at = excluded.created_at`
  )
    .bind(newId(), id, email, role, user.id, iso)
    .run();
  await sendEmail(c.env, companyInviteEmail(c.env, { to: email, companyName: co!.name, inviterName: user.name, role: COMPANY_ROLE_LABELS[role], url, hasAccount: false }));
  return c.json({ added: "invitation" }, 201);
});

companyRoutes.patch("/:id/members/:userId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const target = c.req.param("userId");
  const actorRole = await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const role = oneOf((await readJson(c)).role, "Role", COMPANY_ROLES);
  const current = await companyRole(c.env, id, target);
  if (!current) throw new HttpError(404, "This person is not in the company.");
  if ((current === "owner" || role === "owner") && actorRole !== "owner") throw new HttpError(403, "Only a company owner can add or change owners.");
  if (current === "owner" && role !== "owner" && (await ownerCount(c.env, id)) <= 1) throw new HttpError(400, "A company needs at least one owner. Make someone else an owner first.");
  await c.env.DB.prepare("UPDATE company_members SET role = ? WHERE company_id = ? AND user_id = ?").bind(role, id, target).run();
  return c.json({ role });
});

/** Removes a person from the company and from every project in it. Everyone can leave. */
companyRoutes.delete("/:id/members/:userId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const target = c.req.param("userId");
  const actorRole = await requireCompanyRole(c.env, id, user.id, target === user.id ? [...COMPANY_ROLES] : ["owner", "admin"]);
  const current = await companyRole(c.env, id, target);
  if (!current) throw new HttpError(404, "This person is not in the company.");
  if (current === "owner" && target !== user.id && actorRole !== "owner") throw new HttpError(403, "Only a company owner can remove an owner.");
  if (current === "owner" && (await ownerCount(c.env, id)) <= 1) throw new HttpError(400, "A company needs at least one owner. Make someone else an owner first, or delete the company.");
  await removeFromCompany(c.env, id, target);
  return c.json({ ok: true });
});

export async function removeFromCompany(env: Env, companyId: string, userId: string): Promise<void> {
  const iso = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(userId, companyId),
    env.DB.prepare("DELETE FROM project_members WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(userId, companyId),
    env.DB.prepare("DELETE FROM access_requests WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)").bind(userId, companyId),
    env.DB.prepare("UPDATE projects SET rev = rev + 1, updated_at = ? WHERE company_id = ?").bind(iso, companyId),
    env.DB.prepare("DELETE FROM company_members WHERE company_id = ? AND user_id = ?").bind(companyId, userId),
    env.DB.prepare("UPDATE users SET current_company_id = NULL WHERE id = ? AND current_company_id = ?").bind(userId, companyId)
  ]);
}

companyRoutes.delete("/:id/invitations/:invId", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  await c.env.DB.prepare("DELETE FROM company_invitations WHERE id = ? AND company_id = ?").bind(c.req.param("invId"), id).run();
  return c.json({ ok: true });
});

/**
 * Runs at sign-in. Turns company invitations into memberships, and adds people whose
 * email domain a company claimed. Returns nothing. Failures here never block a sign-in.
 */
export async function joinCompaniesAtSignIn(env: Env, user: User): Promise<void> {
  const iso = nowIso();
  const domain = user.email.toLowerCase().split("@")[1] ?? "";
  const invites = await env.DB.prepare("SELECT id, company_id, role FROM company_invitations WHERE email = ?").bind(user.email).all<{ id: string; company_id: string; role: CompanyRole }>();
  const stmts: D1PreparedStatement[] = [];
  for (const inv of invites.results) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (company_id, user_id) DO UPDATE SET role = CASE WHEN company_members.role = 'guest' THEN excluded.role ELSE company_members.role END"
      ).bind(inv.company_id, user.id, inv.role, iso),
      env.DB.prepare("DELETE FROM company_invitations WHERE id = ?").bind(inv.id)
    );
  }
  if (domain) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO company_members (company_id, user_id, role, created_at)
         SELECT id, ?, 'member', ? FROM companies WHERE email_domain = ?
         ON CONFLICT (company_id, user_id) DO UPDATE SET role = CASE WHEN company_members.role = 'guest' THEN 'member' ELSE company_members.role END`
      ).bind(user.id, iso, domain)
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** True when a company invitation or a claimed email domain lets this email sign up. */
export async function companyAllowsSignup(env: Env, email: string): Promise<boolean> {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  const row = await env.DB.prepare("SELECT 1 AS ok FROM company_invitations WHERE email = ? UNION SELECT 1 FROM companies WHERE email_domain = ? LIMIT 1").bind(email, domain).first();
  return !!row;
}
