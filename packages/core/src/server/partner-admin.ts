import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import type { PartnerClientPeople } from "../shared/partners";
import type { CompanyRole } from "../shared/types";
import { companyRole } from "./data";
import { removeFromCompany } from "./companies";
import { forgetPartnerLinks, partnerLink } from "./partner-link";
import { forgetPartners } from "./partners";
import { requireSuperAdmin } from "./site";
import { HttpError, nowIso, readJson } from "./util";

/*
 * Partner controls for super admins. See docs/partners.md.
 *
 * PUT  /api/site/partners/company/:companyId          { paused?, ownAiRequired? }  pause a partner, or let it use the site's AI
 * GET  /api/site/partners/company/:companyId/clients  the partner's client companies and their people
 * POST /api/site/partners/clients/:companyId/handover { userId, removePartnerPeople?, release? }
 *
 * The handover is for a partner that is gone: a person in the client company becomes its owner, without the partner.
 */

export const sitePartnerAdminRoutes = new Hono<AppEnv>();

const noTable = (e: unknown) => /no such (table|column)/i.test(String(e));

/** Throws 404 unless the company is a partner: it has a partner domain or client companies. */
async function requirePartnerCompany(env: Env, companyId: string): Promise<{ name: string }> {
  const link = await partnerLink(env, companyId);
  if (!link || link.isClient || link.partnerId !== companyId) {
    throw new HttpError(404, "This company is not a partner. Add a partner domain for it first.");
  }
  return { name: link.name };
}

sitePartnerAdminRoutes.put("/company/:companyId", async (c) => {
  const user = requireSuperAdmin(c);
  const companyId = c.req.param("companyId");
  await requirePartnerCompany(c.env, companyId);
  const body = await readJson(c);
  if (body.paused !== undefined && typeof body.paused !== "boolean") throw new HttpError(400, "Say if the partner is paused: true or false.");
  if (body.ownAiRequired !== undefined && typeof body.ownAiRequired !== "boolean")
    throw new HttpError(400, "Say if the partner must bring its own AI keys: true or false.");
  if (body.paused === undefined && body.ownAiRequired === undefined) throw new HttpError(400, "Send paused, ownAiRequired, or both.");
  const iso = nowIso();
  try {
    await c.env.DB.prepare("INSERT INTO partners (company_id, updated_at) VALUES (?, ?) ON CONFLICT (company_id) DO NOTHING").bind(companyId, iso).run();
    if (body.paused !== undefined) {
      await c.env.DB.prepare(
        "UPDATE partners SET paused_at = CASE WHEN ? THEN COALESCE(paused_at, ?) ELSE NULL END, paused_by = CASE WHEN ? THEN ? ELSE NULL END, updated_at = ? WHERE company_id = ?"
      )
        .bind(body.paused ? 1 : 0, iso, body.paused ? 1 : 0, user.id, iso, companyId)
        .run();
    }
    if (body.ownAiRequired !== undefined) {
      await c.env.DB.prepare("UPDATE partners SET is_own_ai_required = ?, updated_at = ? WHERE company_id = ?").bind(body.ownAiRequired ? 1 : 0, iso, companyId).run();
    }
  } catch (e) {
    if (noTable(e)) throw new HttpError(503, "The partners table is missing. Run the database migrations, then try again.");
    throw e;
  }
  forgetPartnerLinks();
  forgetPartners();
  const link = await partnerLink(c.env, companyId);
  return c.json({ companyId, paused: !!link?.paused, ownAiRequired: !!link?.ownAiRequired });
});

async function clientPeople(env: Env, partnerId: string, name: string): Promise<PartnerClientPeople> {
  const [companies, people] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, created_at FROM companies WHERE partner_id = ? ORDER BY name COLLATE NOCASE LIMIT 1000").bind(partnerId),
    env.DB.prepare(
      `SELECT m.company_id, m.user_id, m.role, u.name, u.email,
         EXISTS (SELECT 1 FROM company_members pm WHERE pm.company_id = ? AND pm.user_id = m.user_id) AS partner_person
       FROM company_members m JOIN users u ON u.id = m.user_id
       WHERE m.company_id IN (SELECT id FROM companies WHERE partner_id = ?)
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name COLLATE NOCASE`
    ).bind(partnerId, partnerId)
  ]);
  type P = { company_id: string; user_id: string; role: CompanyRole; name: string; email: string; partner_person: number };
  const byCompany = new Map<string, P[]>();
  for (const p of people.results as P[]) byCompany.set(p.company_id, [...(byCompany.get(p.company_id) ?? []), p]);
  return {
    partner: { companyId: partnerId, name },
    clients: (companies.results as Array<{ id: string; name: string; created_at: string }>).map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.created_at,
      people: (byCompany.get(k.id) ?? []).map((p) => ({ userId: p.user_id, name: p.name, email: p.email, role: p.role, partnerPerson: p.partner_person === 1 }))
    }))
  };
}

sitePartnerAdminRoutes.get("/company/:companyId/clients", async (c) => {
  requireSuperAdmin(c);
  const companyId = c.req.param("companyId");
  const { name } = await requirePartnerCompany(c.env, companyId);
  return c.json(await clientPeople(c.env, companyId, name));
});

sitePartnerAdminRoutes.post("/clients/:companyId/handover", async (c) => {
  requireSuperAdmin(c);
  const companyId = c.req.param("companyId");
  const body = await readJson(c);
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (body.removePartnerPeople !== undefined && typeof body.removePartnerPeople !== "boolean") throw new HttpError(400, "removePartnerPeople must be true or false.");
  if (body.release !== undefined && typeof body.release !== "boolean") throw new HttpError(400, "release must be true or false.");
  const company = await c.env.DB.prepare("SELECT id, partner_id FROM companies WHERE id = ?").bind(companyId).first<{ id: string; partner_id: string | null }>();
  if (!company) throw new HttpError(404, "This company does not exist.");
  const partnerId = company.partner_id;
  if (!partnerId) throw new HttpError(400, "This company is not a client company of a partner.");
  const role = userId ? await companyRole(c.env, companyId, userId) : null;
  if (!role || role === "guest") throw new HttpError(400, "Pick a person in this company. A guest cannot become an owner.");

  await c.env.DB.prepare("UPDATE company_members SET role = 'owner' WHERE company_id = ? AND user_id = ?").bind(companyId, userId).run();

  let removed = 0;
  if (body.removePartnerPeople) {
    const rows = await c.env.DB.prepare(
      `SELECT m.user_id FROM company_members m
       WHERE m.company_id = ? AND m.user_id != ? AND m.user_id IN (SELECT user_id FROM company_members WHERE company_id = ?)`
    )
      .bind(companyId, userId, partnerId)
      .all<{ user_id: string }>();
    // The new owner stays, so the company always keeps an owner.
    for (const r of rows.results) {
      await removeFromCompany(c.env, companyId, r.user_id);
      removed++;
    }
  }
  if (body.release) {
    await c.env.DB.prepare("UPDATE companies SET partner_id = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), companyId).run();
  }
  forgetPartnerLinks();
  return c.json({ ok: true, owner: userId, removed, released: !!body.release });
});
