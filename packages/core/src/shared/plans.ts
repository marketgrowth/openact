/*
 * OpenAct plans. Pure module, used by the Worker, the web app and tests.
 *
 * The core, the UI kit and the Projects app are free and open source. Paid apps need a plan:
 *   - Free: the open source core with the apps that need no plan.
 *   - Director: paid apps for startups to midmarket companies: Docs and Advisory.
 *   - Producer: everything in Director, for enterprise companies.
 *
 * A company gets a plan from an annual subscription on this deploy, or from the deploy's license key.
 * An app asks for a plan with "plan" in the "openact" field of its package.json.
 */

export const PLAN_IDS = ["free", "director", "producer"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PAID_PLANS = ["director", "producer"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export interface PlanInfo {
  id: PlanId;
  /** The full name, such as "OpenAct Director". */
  name: string;
  /** The short name for badges, such as "Director". */
  short: string;
  /** Who the plan is for. */
  audience: string;
}

export const PLANS: Record<PlanId, PlanInfo> = {
  free: { id: "free", name: "OpenAct", short: "Free", audience: "The open source core, the UI and the Projects app." },
  director: { id: "director", name: "OpenAct Director", short: "Director", audience: "For startups to midmarket companies." },
  producer: { id: "producer", name: "OpenAct Producer", short: "Producer", audience: "For enterprise companies. Includes everything in Director." }
};

export const isPlanId = (v: unknown): v is PlanId => (PLAN_IDS as readonly unknown[]).includes(v);
export const isPaidPlan = (v: unknown): v is PaidPlan => (PAID_PLANS as readonly unknown[]).includes(v);

/** True when a company on plan `have` may use an app that needs plan `need`. Producer includes Director. */
export function planIncludes(have: PlanId, need: PlanId | null | undefined): boolean {
  if (!need) return true;
  return PLAN_IDS.indexOf(have) >= PLAN_IDS.indexOf(need);
}

/** The higher of two plans. */
export const higherPlan = (a: PlanId, b: PlanId): PlanId => (PLAN_IDS.indexOf(a) >= PLAN_IDS.indexOf(b) ? a : b);

/** The badge and the sentence for an app that needs a plan, such as "Part of OpenAct Director". */
export const planPart = (plan: PaidPlan): string => `Part of ${PLANS[plan].name}`;

/* Subscriptions */

/** Stripe subscription statuses that keep the plan. past_due keeps it while Stripe retries the card. */
export const ACTIVE_STATUSES = ["active", "trialing", "past_due"] as const;

/** Days after the paid period ends before the plan stops, in case a renewal message from Stripe is late. */
export const SUBSCRIPTION_GRACE_DAYS = 7;

/** Days after a license key expires before the plan stops, so the deploy has time to put in a new key. */
export const LICENSE_GRACE_DAYS = 14;

const DAY_MS = 86400000;

/** True when a subscription gives its plan at `now`. */
export function subscriptionActive(status: string | null | undefined, periodEnd: string | null | undefined, now = Date.now()): boolean {
  if (!status || !(ACTIVE_STATUSES as readonly string[]).includes(status)) return false;
  if (!periodEnd) return true;
  const end = Date.parse(periodEnd);
  return Number.isNaN(end) || now <= end + SUBSCRIPTION_GRACE_DAYS * DAY_MS;
}

/* License keys */

/** The prefix of an OpenAct license key, version 1. */
export const LICENSE_PREFIX = "oa1";

/** What a license key says. MarketGrowth signs it with Ed25519. */
export interface LicensePayload {
  /** The license id, such as "lic_2026_0001". */
  id: string;
  /** The id of the signing key, so keys can change over time. */
  kid: string;
  /** Who the license is for, such as a company name. */
  licensee: string;
  plan: PaidPlan;
  /** The first day, as YYYY-MM-DD. */
  issuedAt: string;
  /** The last day, as YYYY-MM-DD. */
  expiresAt: string;
  /** Optional. The host names where the key works, such as ["app.example.com"]. Empty or missing: any host. */
  hosts?: string[];
}

const fromB64Url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
};

export const toB64Url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Splits and reads a license key without checking the signature.
 * Returns the payload, the signed text and the signature, or an error message.
 */
export function parseLicense(key: string): { payload: LicensePayload; signed: string; signature: Uint8Array } | { error: string } {
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return { error: "The license key is not in the OpenAct format. It starts with oa1." };
  let payload: LicensePayload;
  let signature: Uint8Array;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(parts[1]!)));
    signature = fromB64Url(parts[2]!);
  } catch {
    return { error: "The license key is damaged. Copy the whole key again." };
  }
  if (!payload || typeof payload !== "object") return { error: "The license key is damaged. Copy the whole key again." };
  if (typeof payload.id !== "string" || typeof payload.kid !== "string" || typeof payload.licensee !== "string")
    return { error: "The license key is missing its id or licensee." };
  if (!isPaidPlan(payload.plan)) return { error: "The license key names a plan that this OpenAct does not know." };
  if (!DATE.test(payload.issuedAt ?? "") || !DATE.test(payload.expiresAt ?? "")) return { error: "The license key has no valid dates." };
  if (payload.hosts !== undefined && (!Array.isArray(payload.hosts) || payload.hosts.some((h) => typeof h !== "string")))
    return { error: "The license key has a bad host list." };
  return { payload, signed: `${parts[0]}.${parts[1]}`, signature };
}

/** The end of a license's last day, in milliseconds. */
export const licenseEnd = (p: Pick<LicensePayload, "expiresAt">): number => Date.parse(`${p.expiresAt}T23:59:59Z`);

/** "valid", "grace" (expired, but inside the grace days), or "expired". */
export function licenseTime(p: Pick<LicensePayload, "expiresAt">, now = Date.now()): "valid" | "grace" | "expired" {
  const end = licenseEnd(p);
  if (now <= end) return "valid";
  if (now <= end + LICENSE_GRACE_DAYS * DAY_MS) return "grace";
  return "expired";
}

/** True when the license works on this host. */
export function licenseHostOk(p: Pick<LicensePayload, "hosts">, host: string | null): boolean {
  if (!p.hosts?.length) return true;
  if (!host) return false;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return p.hosts.some((x) => x.toLowerCase() === h);
}

/* What the web app reads. GET /api/companies/:id/plan */

export interface PlanOffer {
  plan: PaidPlan;
  name: string;
  audience: string;
  /** The annual price from Stripe, or null when it is not set up. */
  price: { amount: number; currency: string; interval: string } | null;
  /** True when a company owner can buy it on this deploy now. */
  buyable: boolean;
}

export interface CompanyPlan {
  plan: PlanId;
  /** Where the plan comes from. */
  source: "free" | "subscription" | "license";
  /** The subscription, when the company has one, even when it stopped. */
  subscription: null | {
    plan: PaidPlan;
    status: string;
    /** The end of the paid year, as an ISO time. */
    periodEnd: string | null;
    /** True when it stops at the end of the paid year. */
    cancelAtPeriodEnd: boolean;
    active: boolean;
  };
  /** The deploy's license, when it has one that works. */
  license: null | { licensee: string; plan: PaidPlan; expiresAt: string; inGrace: boolean };
  /** True when this person can buy or change the plan. Company owners can. */
  canManage: boolean;
  /** True when this deploy sells plans through Stripe. */
  billing: boolean;
  offers: PlanOffer[];
  /** A page to ask about plans, such as for Producer. */
  contactUrl: string | null;
  /** Installed apps that need a plan. */
  apps: Array<{ id: string; name: string; plan: PaidPlan; unlocked: boolean }>;
}

/** Formats a price like "$1,200 a year". */
export function formatPrice(p: { amount: number; currency: string; interval: string }): string {
  let money: string;
  try {
    money = new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency.toUpperCase(), maximumFractionDigits: p.amount % 100 ? 2 : 0 }).format(
      p.amount / 100
    );
  } catch {
    money = `${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`;
  }
  return `${money} a ${p.interval === "month" ? "month" : "year"}`;
}
