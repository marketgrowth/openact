import type { Env } from "./env";
import { deployLicense } from "./license.ts";
import { higherPlan, licenseGivesPlan, subscriptionActive, type LicensePayload, type PaidPlan, type PlanId } from "../shared/plans.ts";
import { utcDay } from "../shared/grants.ts";

/*
 * The plan of a company: the higher of its subscription on this deploy and the deploy's license key.
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
  source: "free" | "subscription" | "license";
  row: PlanRow | null;
  subscriptionActive: boolean;
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

/** Works out the plan from a subscription row and a license. Pure, for tests. */
export function resolvePlan(
  row: Pick<PlanRow, "plan" | "status" | "period_end"> | null,
  license: { ok: true; payload: Pick<LicensePayload, "plan" | "use"> } | { ok: false } | null,
  now = Date.now()
): { plan: PlanId; source: CompanyPlanState["source"]; subscriptionActive: boolean } {
  const subActive = !!row && (row.plan === "director" || row.plan === "producer") && subscriptionActive(row.status, row.period_end, now);
  const fromSub: PlanId = subActive ? (row!.plan as PaidPlan) : "free";
  // A grants key gives no company a plan. See grantCeiling().
  const fromLicense: PlanId = license?.ok && licenseGivesPlan(license.payload) ? license.payload.plan : "free";
  const plan = higherPlan(fromSub, fromLicense);
  const source = plan === "free" ? "free" : fromSub === plan ? "subscription" : "license";
  return { plan, source, subscriptionActive: subActive };
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
  const [row, license] = await Promise.all([planRow(env, companyId), deployLicense(env, requestUrl)]);
  return { ...resolvePlan(row, license), row, license };
}
