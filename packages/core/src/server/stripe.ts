import { isPaidPlan, type PaidPlan } from "../shared/plans.ts";

/*
 * Stripe helpers for plans that need no network: webhook signatures and subscription fields.
 * Pure, so tests can run them.
 */

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Compares two strings in constant time for equal lengths. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks the Stripe-Signature header of a webhook request.
 * Stripe signs "<timestamp>.<raw body>" with HMAC-SHA256 and the endpoint's signing secret.
 * Events older or newer than `toleranceSec` are refused, so an old message cannot be sent again.
 */
export async function verifyStripeSignature(
  secret: string,
  header: string | null | undefined,
  body: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300
): Promise<boolean> {
  if (!secret || !header) return false;
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((x) => x?.trim() ?? "");
    if (k === "t") t = v!;
    else if (k === "v1" && v) sigs.push(v);
  }
  const ts = Number(t);
  if (!t || !Number.isInteger(ts) || !sigs.length) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some((s) => sameText(s, expected));
}

/** The parts of a Stripe subscription object that plans use. */
export interface StripeSubscription {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end?: boolean;
  /** Older Stripe API versions. */
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
}

export interface SubscriptionFields {
  companyId: string | null;
  plan: PaidPlan | null;
  status: string;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  customerId: string;
  subscriptionId: string;
}

/**
 * Reads what plans need from a subscription. The price decides the plan, so a change of plan
 * in the Stripe billing portal shows up. The plan in the metadata is the fallback.
 */
export function subscriptionFields(sub: StripeSubscription, prices: Partial<Record<PaidPlan, string>>): SubscriptionFields {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? "";
  const byPrice = (Object.entries(prices) as Array<[PaidPlan, string | undefined]>).find(([, id]) => id && id === priceId)?.[0] ?? null;
  const fromMeta = sub.metadata?.plan;
  const end = item?.current_period_end ?? sub.current_period_end;
  return {
    companyId: sub.metadata?.company_id || null,
    plan: byPrice ?? (isPaidPlan(fromMeta) ? fromMeta : null),
    status: sub.status,
    periodEnd: typeof end === "number" ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    subscriptionId: sub.id
  };
}
