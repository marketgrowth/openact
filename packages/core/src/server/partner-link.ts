import type { Env } from "./env";

/*
 * The partner of a company, for the rules that follow a partner: who pays for AI, and whether the service is paused.
 * See docs/partners.md.
 *
 * A company belongs to a partner when it is a client company of the partner (companies.partner_id), or when it is the
 * partner itself (it has a partner domain or client companies). Every other company has no partner.
 *
 * Kept in its own file with no other server imports, so permissions, AI and the partner routes can all use it.
 */

export interface PartnerLink {
  /** The partner's company. */
  partnerId: string;
  /** The name people see: the name of the partner's first named host, or else its company name. */
  name: string;
  /** True for a client company of the partner. False for the partner's own company. */
  isClient: boolean;
  /** True when the partner and its clients must bring their own AI keys. On unless a super admin turned it off. */
  ownAiRequired: boolean;
  /** True while a super admin has the partner paused. */
  paused: boolean;
}

const TTL_MS = 15_000;
const cache = new Map<string, { link: PartnerLink | null; at: number }>();

/** Forgets the cached links, after a super admin changes a partner or a company leaves its partner. */
export function forgetPartnerLinks(): void {
  cache.clear();
}

type Row = { partner_id: string; company_name: string; domain_name: string | null; is_client: number; is_own_ai_required: number | null; paused_at: string | null };

/** The partner of a company, or null. Before migration 0015 runs, every company has none. */
export async function partnerLink(env: Env, companyId: string | null | undefined): Promise<PartnerLink | null> {
  if (!companyId) return null;
  const hit = cache.get(companyId);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.link;
  let link: PartnerLink | null = null;
  try {
    const row = await env.DB.prepare(
      `SELECT p.id AS partner_id, p.name AS company_name, k.partner_id IS NOT NULL AS is_client,
         (SELECT d.name FROM partner_domains d WHERE d.company_id = p.id AND d.name IS NOT NULL ORDER BY d.created_at LIMIT 1) AS domain_name,
         s.is_own_ai_required, s.paused_at
       FROM companies k
       JOIN companies p ON p.id = COALESCE(k.partner_id, k.id)
       LEFT JOIN partners s ON s.company_id = p.id
       WHERE k.id = ?
         AND (k.partner_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM partner_domains d2 WHERE d2.company_id = k.id)
           OR EXISTS (SELECT 1 FROM companies c2 WHERE c2.partner_id = k.id))`
    )
      .bind(companyId)
      .first<Row>();
    if (row)
      link = {
        partnerId: row.partner_id,
        name: row.domain_name || row.company_name,
        isClient: row.is_client === 1,
        ownAiRequired: row.is_own_ai_required !== 0,
        paused: !!row.paused_at
      };
  } catch (e) {
    if (!/no such (table|column)/i.test(String(e))) throw e;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(companyId, { link, at: now });
  return link;
}
