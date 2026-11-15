/*
 * App grants: a super admin gives one person a paid app, such as Docs, without a paid plan.
 * Grants work only on a deploy with a MarketGrowth license key, up to the key's plan. A key made with
 * `--use grants` allows grants without giving every company the plan.
 * The grant unlocks the app in every company where that person is an owner, so the people in that company can use it too.
 * The app's company switch and the role permissions still apply.
 */
import type { PaidPlan } from "./plans.ts";

/** One grant, as Site settings shows it. */
export interface AppGrant {
  appId: string;
  /** The last day of the grant (YYYY-MM-DD, UTC), or null for no end. */
  endsOn: string | null;
  /** False when the end day is in the past. */
  active: boolean;
  createdAt: string;
}

/** A person in Site settings > Paid app access. */
export interface GrantUser {
  id: string;
  name: string;
  email: string;
  /** The number of companies where the person is an owner. A grant does nothing until this is 1 or more. */
  ownerOf: number;
  grants: AppGrant[];
}

/** GET /api/site/grants. Super admins only. */
export interface SiteGrants {
  /** The paid apps that the deploy's license key lets a super admin grant. */
  apps: Array<{ id: string; name: string; plan: PaidPlan }>;
  /** True when some installed paid apps cannot be granted, because the deploy has no license key that covers them. */
  needsLicense: boolean;
  /** With a search: the people who match. Without one: the people who have a grant. */
  users: GrantUser[];
}

/** Today in UTC, as YYYY-MM-DD. */
export const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

/** True while the grant has not ended. A grant works through the whole of its end day (UTC). */
export function grantActive(endsOn: string | null | undefined, now = Date.now()): boolean {
  return !endsOn || endsOn >= utcDay(now);
}

/** Checks the end day from a request. Empty means no end. */
export function cleanGrantEnd(raw: unknown, now = Date.now()): { endsOn: string | null } | { problem: string } {
  if (raw === null || raw === undefined || raw === "") return { endsOn: null };
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return {
      problem: "Use a date such as 2027-06-30 for the end day, or leave it empty."
    };
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== raw) return { problem: "The end day is not a real date." };
  if (raw < utcDay(now))
    return {
      problem: "The end day is in the past. Choose today or a later day."
    };
  return { endsOn: raw };
}
