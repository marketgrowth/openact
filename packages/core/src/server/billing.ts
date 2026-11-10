import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "./env";
import { requireCompanyRole } from "./data";
import { HttpError, appUrl, nowIso, oneOf, readJson, requireUser, text } from "./util";
import { companyPlan, planRow } from "./plans";
import { getCatalog } from "./permissions";
import { subscriptionFields, verifyStripeSignature, type StripeSubscription, type SubscriptionFields } from "./stripe";
import { PAID_PLANS, PLANS, planIncludes, type CompanyPlan, type PaidPlan, type PlanOffer } from "../shared/plans";

/*
 * Plans for sale on this deploy: an annual Stripe subscription per company.
 *
 *   GET  /api/companies/:id/plan            The plan, the offers and the apps that need a plan. Any member.
 *   POST /api/companies/:id/plan/checkout   Starts Stripe Checkout for Director or Producer. Owners only.
 *   POST /api/companies/:id/plan/portal     Opens the Stripe billing portal to change, renew or cancel. Owners only.
 *   POST /api/billing/checkout-sync         Saves the subscription when the person comes back from Checkout.
 *   POST /api/billing/stripe-webhook        Stripe sends subscription changes here.
 *
 * Plans are for sale when STRIPE_SECRET_KEY and a plan's price (STRIPE_PRICE_DIRECTOR, STRIPE_PRICE_PRODUCER) are set.
 * Plans always use the deploy's own Stripe account. STRIPE_ACCOUNT, for contributions, does not apply.
 */

const prices = (env: Env): Partial<Record<PaidPlan, string>> => ({
  director: (env.STRIPE_PRICE_DIRECTOR || "").trim() || undefined,
  producer: (env.STRIPE_PRICE_PRODUCER || "").trim() || undefined
});

const stripeKey = (env: Env) => (env.STRIPE_SECRET_KEY || "").trim();
const billingOn = (env: Env) => !!stripeKey(env) && Object.values(prices(env)).some(Boolean);

async function stripe<T>(env: Env, method: "GET" | "POST", path: string, form?: URLSearchParams): Promise<T> {
  const key = stripeKey(env);
  if (!key) throw new HttpError(404, "Plans are not for sale on this site.");
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: form,
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new HttpError(502, "Stripe cannot be reached. Try again in a minute.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { type?: string; code?: string } }) | null;
  if (!res.ok || !data) {
    // Log the error type only. Never log the key.
    console.warn("[openact] Stripe request failed", path.split("/")[0], res.status, data?.error?.type, data?.error?.code);
    throw new HttpError(502, "Stripe did not answer as expected. Try again, or ask the person who runs this site.");
  }
  return data;
}

/* Prices change rarely. Each isolate keeps them for 10 minutes. */
const priceCache = new Map<string, { at: number; price: PlanOffer["price"] }>();

async function priceOf(env: Env, priceId: string): Promise<PlanOffer["price"]> {
  const hit = priceCache.get(priceId);
  if (hit && Date.now() - hit.at < 600_000) return hit.price;
  let price: PlanOffer["price"] = null;
  try {
    const p = await stripe<{ unit_amount: number | null; currency: string; recurring?: { interval?: string } | null }>(
      env,
      "GET",
      `prices/${encodeURIComponent(priceId)}`
    );
    if (p.unit_amount !== null) price = { amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval ?? "year" };
  } catch {
    price = null;
  }
  priceCache.set(priceId, { at: Date.now(), price });
  return price;
}

/** Saves a subscription for a company. Ignores companies that no longer exist. */
async function saveSubscription(env: Env, f: SubscriptionFields): Promise<void> {
  let companyId = f.companyId;
  if (!companyId) {
    const row = await env.DB.prepare("SELECT company_id FROM company_plans WHERE stripe_subscription_id = ?").bind(f.subscriptionId).first<{ company_id: string }>();
    companyId = row?.company_id ?? null;
  }
  if (!companyId || !f.plan) {
    console.warn("[openact] A Stripe subscription has no OpenAct company or plan. It was not saved.", f.subscriptionId);
    return;
  }
  const company = await env.DB.prepare("SELECT 1 AS x FROM companies WHERE id = ?").bind(companyId).first();
  if (!company) return;
  // A company has one subscription. A new active one replaces an old one that stopped.
  const existing = await planRow(env, companyId);
  if (existing && existing.stripe_subscription_id && existing.stripe_subscription_id !== f.subscriptionId) {
    const stillActive = ["active", "trialing", "past_due"].includes(existing.status);
    if (stillActive && !["active", "trialing", "past_due"].includes(f.status)) return; // An old or failed one never replaces a live one.
  }
  await env.DB.prepare(
    `INSERT INTO company_plans (company_id, plan, status, period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, period_end = excluded.period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id, updated_at = excluded.updated_at`
  )
    .bind(companyId, f.plan, f.status, f.periodEnd, f.cancelAtPeriodEnd ? 1 : 0, f.customerId, f.subscriptionId, nowIso())
    .run();
}

/** True when the company pays for a plan that renews, so deleting it would keep charging. */
export async function hasRenewingSubscription(env: Env, companyId: string): Promise<boolean> {
  const row = await planRow(env, companyId);
  return !!row && ["active", "trialing", "past_due"].includes(row.status) && row.cancel_at_period_end !== 1;
}

async function planDetail(c: Context<AppEnv>, companyId: string, canManage: boolean): Promise<CompanyPlan> {
  const env = c.env;
  const state = await companyPlan(env, companyId, c.req.url);
  const on = billingOn(env);
  const p = prices(env);
  const offers: PlanOffer[] = await Promise.all(
    PAID_PLANS.map(async (plan) => {
      const priceId = p[plan];
      const price = on && priceId ? await priceOf(env, priceId) : null;
      return { plan, name: PLANS[plan].name, audience: PLANS[plan].audience, price, buyable: on && !!priceId && !!price };
    })
  );
  const row = state.row;
  const contact = (env.PLANS_CONTACT_URL || "").trim();
  return {
    plan: state.plan,
    source: state.source,
    subscription:
      row && (row.plan === "director" || row.plan === "producer")
        ? {
            plan: row.plan,
            status: row.status,
            periodEnd: row.period_end,
            cancelAtPeriodEnd: row.cancel_at_period_end === 1,
            active: state.subscriptionActive
          }
        : null,
    license: state.license?.ok
      ? { licensee: state.license.payload.licensee, plan: state.license.payload.plan, expiresAt: state.license.payload.expiresAt, inGrace: state.license.inGrace }
      : null,
    canManage: canManage && on,
    billing: on,
    offers,
    contactUrl: /^(https:\/\/|mailto:)/i.test(contact) ? contact : null,
    apps: getCatalog()
      .filter((a) => a.plan)
      .map((a) => ({ id: a.id, name: a.name, plan: a.plan!, unlocked: planIncludes(state.plan, a.plan) }))
  };
}

export const companyPlanRoutes = new Hono<AppEnv>();

companyPlanRoutes.get("/:id/plan", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireCompanyRole(c.env, id, user.id, ["owner", "admin", "member"]);
  return c.json(await planDetail(c, id, role === "owner"));
});

companyPlanRoutes.post("/:id/plan/checkout", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const body = await readJson(c);
  const plan = oneOf(body.plan, "Plan", PAID_PLANS);
  const priceId = prices(c.env)[plan];
  if (!billingOn(c.env) || !priceId) throw new HttpError(400, `${PLANS[plan].name} is not for sale on this site. Ask the person who runs it.`);
  const row = await planRow(c.env, id);
  if (row && ["active", "trialing", "past_due"].includes(row.status))
    throw new HttpError(400, "This company already has a plan. Change it with Manage billing.", "has_plan");

  const base = appUrl(c);
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: id,
    allow_promotion_codes: "true",
    success_url: `${base}/plan?checkout=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/plan`,
    "metadata[source]": "openact-plan",
    "metadata[company_id]": id,
    "metadata[plan]": plan,
    "subscription_data[metadata][source]": "openact-plan",
    "subscription_data[metadata][company_id]": id,
    "subscription_data[metadata][plan]": plan,
    "subscription_data[metadata][site]": new URL(base).hostname
  });
  if (row?.stripe_customer_id) form.set("customer", row.stripe_customer_id);
  else form.set("customer_email", user.email);
  const session = await stripe<{ url?: string }>(c.env, "POST", "checkout/sessions", form);
  if (!session.url) throw new HttpError(502, "Stripe did not start the checkout. Try again.");
  return c.json({ url: session.url });
});

companyPlanRoutes.post("/:id/plan/portal", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const row = await planRow(c.env, id);
  if (!row?.stripe_customer_id) throw new HttpError(400, "This company has no billing account yet. Choose a plan first.");
  const session = await stripe<{ url?: string }>(
    c.env,
    "POST",
    "billing_portal/sessions",
    new URLSearchParams({ customer: row.stripe_customer_id, return_url: `${appUrl(c)}/plan` })
  );
  if (!session.url) throw new HttpError(502, "Stripe did not open the billing page. Try again.");
  return c.json({ url: session.url });
});

export const billingRoutes = new Hono<AppEnv>();

/** After Checkout, the Plan page sends the session id here, so the plan works before the webhook arrives. */
billingRoutes.post("/checkout-sync", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const sessionId = text(body.sessionId, "Session id", { max: 255, required: true });
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new HttpError(400, "This is not a Stripe Checkout session id.");
  const session = await stripe<{ metadata?: Record<string, string>; subscription?: string | StripeSubscription | null; status?: string }>(
    c.env,
    "GET",
    `checkout/sessions/${sessionId}?expand[]=subscription`
  );
  const companyId = session.metadata?.company_id;
  if (session.metadata?.source !== "openact-plan" || !companyId) throw new HttpError(400, "This checkout is not for an OpenAct plan.");
  await requireCompanyRole(c.env, companyId, user.id, ["owner", "admin", "member"]);
  const sub = session.subscription;
  if (!sub || typeof sub === "string") return c.json({ companyId, done: false });
  await saveSubscription(c.env, subscriptionFields(sub, prices(c.env)));
  return c.json({ companyId, done: true });
});

billingRoutes.post("/stripe-webhook", async (c) => {
  const secret = (c.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new HttpError(404, "Plans are not set up on this site.");
  const raw = await c.req.text();
  if (!(await verifyStripeSignature(secret, c.req.header("stripe-signature"), raw))) throw new HttpError(400, "The Stripe signature is not valid.");
  let event: { type?: string; data?: { object?: unknown } };
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "The event is not JSON.");
  }
  if (event.type?.startsWith("customer.subscription.")) {
    const sub = event.data?.object as StripeSubscription | undefined;
    // Only subscriptions that OpenAct started. Contributions use the same Stripe account.
    if (sub?.id && sub.metadata?.source === "openact-plan") await saveSubscription(c.env, subscriptionFields(sub, prices(c.env)));
  }
  return c.json({ received: true });
});
