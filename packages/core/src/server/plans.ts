import type { Env } from "./env";
import { deployLicense } from "./license.ts";
import { higherPlan, licenseGivesPlan, subscriptionActive, type LicensePayload, type PaidPlan, type PlanId } from "../shared/plans.ts";
import { utcDay } from "../shared/grants.ts";
import { parseEmailList } from "../shared/site.ts";

/*
 * The plan of a company: the highest of
 *   - its own subscription on this deploy,
 *   - the site plan: the subscription of a company that a super owner owns (see sitePlan()),
 *   - the deploy's license key.
 * Apps that need a plan are locked without it. See companyAppState() in permissions.ts.
 */

export interface PlanRow {
  company_id: string;
  plan: string;
  status: string;
  period_end: string | null;
  cancel_at_period_end: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  updated_at: string;
}

export interface CompanyPlanState {
  plan: PlanId;
  source: "free" | "subscription" | "site" | "license";
  row: PlanRow | null;
  subscriptionActive: boolean;
  /** The plan that a super owner pays for. Every company on the deploy gets it. */
  site: PlanId;
  license: Awaited<ReturnType<typeof deployLicense>>;
}

/** Reads the company's subscription row. Before migration 0008 runs, there is none. */
export async function planRow(env: Env, companyId: string): Promise<PlanRow | null> {
  try {
    return await env.DB.prepare("SELECT * FROM company_plans WHERE company_id = ?").bind(companyId).first<PlanRow>();
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
}

/** The plan that a subscription row gives at `now`, or "free". */
export function rowPlan(row: Pick<PlanRow, "plan" | "status" | "period_end"> | null, now = Date.now()): PlanId {
  const active = !!row && (row.plan === "director" || row.plan === "producer") && subscriptionActive(row.status, row.period_end, now);
  return active ? (row!.plan as PaidPlan) : "free";
}

/** Works out the plan from a subscription row, the site plan and a license. Pure, for tests. */
export function resolvePlan(
  row: Pick<PlanRow, "plan" | "status" | "period_end"> | null,
  license: { ok: true; payload: Pick<LicensePayload, "plan" | "use"> } | { ok: false } | null,
  now = Date.now(),
  site: PlanId = "free"
): { plan: PlanId; source: CompanyPlanState["source"]; subscriptionActive: boolean } {
  const fromSub = rowPlan(row, now);
  // A grants key gives no company a plan. See grantCeiling().
  const fromLicense: PlanId = license?.ok && licenseGivesPlan(license.payload) ? license.payload.plan : "free";
  const plan = higherPlan(higherPlan(fromSub, site), fromLicense);
  const source = plan === "free" ? "free" : fromSub === plan ? "subscription" : site === plan ? "site" : "license";
  return { plan, source, subscriptionActive: fromSub !== "free" };
}

/**
 * The site plan: the highest active subscription of a company that a super owner owns.
 * A super owner is a super admin (SUPER_ADMIN_EMAILS) with the owner role in the company.
 * When the super owner pays for a plan, every company on the deploy gets it.
 * Before migration 0008 runs, there is no site plan.
 */
export async function sitePlan(env: Env, now = Date.now()): Promise<PlanId> {
  const emails = parseEmailList(env.SUPER_ADMIN_EMAILS);
  if (!emails.length) return "free";
  try {
    const rows = await env.DB.prepare(
      `SELECT DISTINCT p.plan, p.status, p.period_end FROM company_plans p
       JOIN company_members m ON m.company_id = p.company_id AND m.role = 'owner'
       JOIN users u ON u.id = m.user_id
       WHERE u.email IN (${emails.map(() => "?").join(", ")})`
    )
      .bind(...emails)
      .all<Pick<PlanRow, "plan" | "status" | "period_end">>();
    return rows.results.reduce<PlanId>((best, r) => higherPlan(best, rowPlan(r, now)), "free");
  } catch (e) {
    if (/no such table/i.test(String(e))) return "free";
    throw e;
  }
}

/**
 * The highest plan whose apps a super admin may grant to one person. It comes from the deploy's license key.
 * Without a working key, grants are off, so the person who runs a deploy cannot unlock paid apps for free.
 */
export function grantCeiling(license: Awaited<ReturnType<typeof deployLicense>>): PlanId {
  return license?.ok ? license.payload.plan : "free";
}

/**
 * The paid apps that a super admin granted to an owner of the company. See app_grants (migration 0009).
 * A grant to an admin, a member or a guest does not count. Before migration 0009 runs, there are none.
 */
export async function ownerGrants(env: Env, companyId: string, now = Date.now()): Promise<Set<string>> {
  try {
    const rows = await env.DB.prepare(
      `SELECT DISTINCT g.app_id FROM app_grants g
       JOIN company_members m ON m.user_id = g.user_id
       WHERE m.company_id = ? AND m.role = 'owner' AND (g.ends_on IS NULL OR g.ends_on >= ?)`
    )
      .bind(companyId, utcDay(now))
      .all<{ app_id: string }>();
    return new Set(rows.results.map((r) => r.app_id));
  } catch (e) {
    if (/no such table/i.test(String(e))) return new Set();
    throw e;
  }
}

export async function companyPlan(env: Env, companyId: string, requestUrl?: string): Promise<CompanyPlanState> {
  const [row, site, license] = await Promise.all([planRow(env, companyId), sitePlan(env), deployLicense(env, requestUrl)]);
  return { ...resolvePlan(row, license, Date.now(), site), row, site, license };
}
