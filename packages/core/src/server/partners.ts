import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import { HttpError, nowIso, readJson, requireUser } from "./util";
import { requireCompanyRole } from "./data";
import { requireSuperAdmin } from "./site";
import { PARTNER_HOSTS_MAX, cleanHost, cleanPartnerName, partnerLogoUrl, type PartnerClients, type PartnerDomain } from "../shared/partners";
import type { CompanyRole, SignInPage } from "../shared/types";
import { partnerLink } from "./partner-link";
import { pausedError } from "./permissions";

/*
 * Partner domains: white label for agencies and other partners. See docs/partners.md.
 *
 * A super admin points a host name, such as app.brightline.com, at one company: the partner.
 * On that host, the app name, the logo, the sign-in page and the emails show the partner.
 * The deploy, the database and the sign-in stay the same: a partner host is another door into the same site.
 *
 * Companies that the partner's owners and admins make on their host get `partner_id`. That counts them as client
 * companies, so the site owner can bill the partner for each one. It never gives access: the partner's people see a
 * client company only when they are its members.
 */

/** A partner, as one request on its host sees it. */
export interface Partner {
  host: string;
  companyId: string;
  /** The name people see: the partner name, or the company name. */
  name: string;
  logoUrl: string | null;
  /** True while a super admin has the partner paused. Set per request by partnerMiddleware. */
  paused?: boolean;
}

const TTL_MS = 30_000;
/** Host name -> partner, or null for a host that is not a partner domain. Kept per isolate for a short time. */
const cache = new Map<string, { partner: Partner | null; at: number }>();

/** Forgets the cached partners, after a super admin changes a partner domain or a partner changes its logo. */
export function forgetPartners(): void {
  cache.clear();
}

/** The partner for a host name, or null. Before migration 0014 runs, every host is null. */
export async function partnerForHost(env: Env, host: string): Promise<Partner | null> {
  const key = host.toLowerCase();
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.partner;
  let partner: Partner | null = null;
  try {
    const row = await env.DB.prepare(
      `SELECT p.host, p.company_id, p.name, c.name AS company_name, c.logo_key, c.logo_updated_at
       FROM partner_domains p JOIN companies c ON c.id = p.company_id WHERE p.host = ?`
    )
      .bind(key)
      .first<{ host: string; company_id: string; name: string | null; company_name: string; logo_key: string | null; logo_updated_at: string | null }>();
    if (row)
      partner = {
        host: row.host,
        companyId: row.company_id,
        name: row.name || row.company_name,
        logoUrl: row.logo_key ? partnerLogoUrl(row.logo_updated_at ?? "") : null
      };
  } catch (e) {
    if (!/no such table/i.test(String(e))) console.warn("[openact] Could not read the partner domains", e);
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { partner, at: now });
  return partner;
}

/**
 * Reads the partner for the request's host. On a partner host, the request gets its own copy of env with
 * PARTNER_NAME set, so appName(env) and every email in this request show the partner. Other requests, also in the
 * same isolate, keep the site name.
 */
export const partnerMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  const found = await partnerForHost(c.env, url.hostname);
  // While the partner is paused, its host answers only what the paused page needs. See docs/partners.md.
  const partner = found ? { ...found, paused: !!(await partnerLink(c.env, found.companyId))?.paused } : null;
  if (partner?.paused && !PAUSED_OPEN.has(url.pathname)) throw pausedError(partner.name);
  c.set("partner", partner);
  if (partner) c.env = { ...c.env, PARTNER_NAME: partner.name };
  await next();
};

/** The API paths that a paused partner host still answers: the paused page needs the name and the logo. */
const PAUSED_OPEN = new Set(["/api/config", "/api/partner/logo", "/api/health"]);

/** What the sign-in page shows on a partner host: the partner's name, and none of the site's own text or links. */
export function partnerSignInPage(p: Partner): SignInPage {
  return { heading: `Sign in to ${p.name}.`, credit: "", termsUrl: null, privacyUrl: null, backgroundUrl: null };
}

/**
 * The partner that a new company belongs to: the partner of this host, when the person who makes the company is an
 * owner or admin of that partner. Anyone else who makes a company on the host makes an ordinary company.
 */
export async function partnerForNewCompany(env: Env, partner: Partner | null, userId: string): Promise<string | null> {
  if (!partner) return null;
  const row = await env.DB.prepare("SELECT role FROM company_members WHERE company_id = ? AND user_id = ?")
    .bind(partner.companyId, userId)
    .first<{ role: string }>();
  return row && (row.role === "owner" || row.role === "admin") ? partner.companyId : null;
}

/** A client company of a partner that one person is in, for an app's partner dashboard. */
export interface PartnerClientCompany {
  id: string;
  name: string;
  /** The person's role in the client company. */
  role: CompanyRole;
  createdAt: string;
}

/**
 * The client companies of a partner that this person is a member of (not a guest), by name. Up to 500.
 * Apps use it for a dashboard across clients, such as the A/GEO Answers client view.
 * It does not check the person's role in the partner company, and it does not check app permissions in each client.
 * The caller checks both: a permission in the partner company first, then a permission in each client before it
 * reads that client's data. A client that removes the person drops off the list.
 */
export async function partnerClientCompanies(env: Env, partnerId: string, userId: string): Promise<PartnerClientCompany[]> {
  const rows = await readPartners(() =>
    env.DB.prepare(
      `SELECT k.id, k.name, k.created_at, m.role FROM companies k
       JOIN company_members m ON m.company_id = k.id AND m.user_id = ?
       WHERE k.partner_id = ? AND m.role != 'guest' ORDER BY k.name COLLATE NOCASE LIMIT 500`
    )
      .bind(userId, partnerId)
      .all<{ id: string; name: string; created_at: string; role: CompanyRole }>()
  );
  return rows.results.map((r) => ({ id: r.id, name: r.name, role: r.role, createdAt: r.created_at }));
}

async function readPartners<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (/no such table|no such column/i.test(String(e))) throw new HttpError(503, "The partner domains table is missing. Run the database migrations, then try again.");
    throw e;
  }
}

/* The partner's logo, on its own host. It is public, because the sign-in page shows it. */
export const partnerRoutes = new Hono<AppEnv>();

partnerRoutes.get("/logo", async (c) => {
  const partner = c.get("partner");
  if (!partner) throw new HttpError(404, "This host is not a partner domain.");
  const row = await c.env.DB.prepare("SELECT logo_key, logo_type FROM companies WHERE id = ?")
    .bind(partner.companyId)
    .first<{ logo_key: string | null; logo_type: string | null }>();
  if (!row?.logo_key) throw new HttpError(404, "This partner has no logo.");
  const obj = await c.env.FILES.get(row.logo_key);
  if (!obj) throw new HttpError(404, "The logo file is missing. Upload it again.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.logo_type || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
});

/* Site settings: super admins add, rename and remove partner domains. */
export const sitePartnerRoutes = new Hono<AppEnv>();

const DOMAIN_SELECT = `SELECT p.host, p.company_id, p.name, p.created_at, c.name AS company_name,
    (SELECT COUNT(*) FROM companies k WHERE k.partner_id = p.company_id) AS clients,
    s.paused_at, s.is_own_ai_required
  FROM partner_domains p JOIN companies c ON c.id = p.company_id LEFT JOIN partners s ON s.company_id = p.company_id`;

type DomainRow = {
  host: string;
  company_id: string;
  name: string | null;
  created_at: string;
  company_name: string;
  clients: number;
  paused_at: string | null;
  is_own_ai_required: number | null;
};

const toDomain = (r: DomainRow): PartnerDomain => ({
  host: r.host,
  companyId: r.company_id,
  companyName: r.company_name,
  name: r.name,
  clients: r.clients,
  createdAt: r.created_at,
  paused: !!r.paused_at,
  ownAiRequired: r.is_own_ai_required !== 0
});

async function oneDomain(env: Env, host: string): Promise<PartnerDomain> {
  const row = await env.DB.prepare(`${DOMAIN_SELECT} WHERE p.host = ?`).bind(host).first<DomainRow>();
  if (!row) throw new HttpError(404, "This partner domain does not exist. It may have been removed.");
  return toDomain(row);
}

/** GET /api/site/partners: every partner domain, with its company and its count of client companies. */
sitePartnerRoutes.get("/", async (c) => {
  requireSuperAdmin(c);
  const rows = await readPartners(() => c.env.DB.prepare(`${DOMAIN_SELECT} ORDER BY c.name COLLATE NOCASE, p.host LIMIT 500`).all<DomainRow>());
  return c.json({ domains: rows.results.map(toDomain) });
});

/** POST /api/site/partners. Body: { host, companyId, name? } */
sitePartnerRoutes.post("/", async (c) => {
  const user = requireSuperAdmin(c);
  const body = await readJson(c);
  const h = cleanHost(body.host);
  if ("problem" in h) throw new HttpError(400, h.problem);
  const n = cleanPartnerName(body.name);
  if ("problem" in n) throw new HttpError(400, n.problem);
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  const company = await c.env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first();
  if (!company) throw new HttpError(404, "This company does not exist. Pick a company from the list.");
  const site = new URL(c.req.url).hostname;
  const appHost = (() => {
    try {
      return c.env.APP_URL ? new URL(c.env.APP_URL).hostname : "";
    } catch {
      return "";
    }
  })();
  if (h.host === site || h.host === appHost) throw new HttpError(400, "This is the site's own host name. Use another host name for the partner.");
  const count = await readPartners(() => c.env.DB.prepare("SELECT COUNT(*) AS n FROM partner_domains WHERE company_id = ?").bind(companyId).first<{ n: number }>());
  if ((count?.n ?? 0) >= PARTNER_HOSTS_MAX) throw new HttpError(400, `A company can have ${PARTNER_HOSTS_MAX} host names. Remove one first.`);
  const taken = await c.env.DB.prepare("SELECT host FROM partner_domains WHERE host = ?").bind(h.host).first();
  if (taken) throw new HttpError(409, "This host name already belongs to a partner. Remove it there first.");
  const iso = nowIso();
  await c.env.DB.prepare("INSERT INTO partner_domains (host, company_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(h.host, companyId, n.name || null, user.id, iso, iso)
    .run();
  forgetPartners();
  return c.json(await oneDomain(c.env, h.host), 201);
});

/** PATCH /api/site/partners/:host. Body: { name } An empty name shows the company name. */
sitePartnerRoutes.patch("/:host", async (c) => {
  requireSuperAdmin(c);
  const host = c.req.param("host").toLowerCase();
  const n = cleanPartnerName((await readJson(c)).name);
  if ("problem" in n) throw new HttpError(400, n.problem);
  await oneDomain(c.env, host);
  await c.env.DB.prepare("UPDATE partner_domains SET name = ?, updated_at = ? WHERE host = ?").bind(n.name || null, nowIso(), host).run();
  forgetPartners();
  return c.json(await oneDomain(c.env, host));
});

/** DELETE /api/site/partners/:host. The client companies stay, and stay counted, until the partner company is deleted. */
sitePartnerRoutes.delete("/:host", async (c) => {
  requireSuperAdmin(c);
  const host = c.req.param("host").toLowerCase();
  await readPartners(() => c.env.DB.prepare("DELETE FROM partner_domains WHERE host = ?").bind(host).run());
  forgetPartners();
  return c.json({ ok: true });
});

/* The partner's own view: its host names and its client companies. For the partner's owners and admins. */
export const companyPartnerRoutes = new Hono<AppEnv>();

/** GET /api/companies/:id/clients */
companyPartnerRoutes.get("/:id/clients", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  const [hosts, clients] = await readPartners(() =>
    c.env.DB.batch([
      c.env.DB.prepare("SELECT host FROM partner_domains WHERE company_id = ? ORDER BY host").bind(id),
      c.env.DB.prepare(
        `SELECT k.id, k.name, k.created_at, (SELECT COUNT(*) FROM company_members m WHERE m.company_id = k.id) AS members
         FROM companies k WHERE k.partner_id = ? ORDER BY k.name COLLATE NOCASE LIMIT 1000`
      ).bind(id)
    ])
  );
  const out: PartnerClients = {
    hosts: (hosts.results as Array<{ host: string }>).map((r) => r.host),
    clients: (clients.results as Array<{ id: string; name: string; created_at: string; members: number }>).map((r) => ({
      id: r.id,
      name: r.name,
      members: r.members,
      createdAt: r.created_at
    }))
  };
  return c.json(out);
});
