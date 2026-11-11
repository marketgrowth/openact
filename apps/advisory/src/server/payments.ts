import { Hono, type Context } from "hono";
import { HttpError, appUrl, newId, nowIso, readJson, requirePermission, requireUser, text, verifyStripeSignature, type AppEnv } from "@openact/core/server";
import { createProject } from "@openact/app-projects/api";
import { ADVISORY_HOME, STRIPE_SOURCE, applicationFee, checkoutForm, engagementProjectName, engagementStatusFor } from "../shared/rules";
import { advisorById, payable, termsOf, type AdvisoryEnv, type RequestRow } from "./data";
import { idOf, stripe, type StripeCheckoutSession, type StripeSubscriptionLite } from "./stripe";
import { engagementEmail, send } from "./emails";
import { readRequest } from "./routes";

/*
 * Payments. The payment page makes a Stripe Checkout Session when the client clicks Pay, so a link never expires.
 * A destination charge sends the money to the advisor's connected account, and the brand keeps the application fee.
 *
 * Stripe confirms the payment in two ways, and both are safe to run twice:
 *   POST /api/apps/advisory/checkout-sync    The payment page sends the session id when the client comes back.
 *   POST /api/apps/advisory/stripe-webhook   Stripe sends checkout and subscription events.
 * A confirmed payment marks the request as paid and opens a secret project in the Projects app,
 * with the advisor as the owner and the client as an editor.
 */

type C = Context<AppEnv>;
const envOf = (c: C) => c.env as AdvisoryEnv;

export const paymentRoutes = new Hono<AppEnv>();

paymentRoutes.post("/companies/:cid/requests/:rid/checkout", async (c) => {
  const user = requireUser(c);
  const cid = c.req.param("cid");
  const env = envOf(c);
  const { row, role } = await readRequest(c, cid, c.req.param("rid"));
  if (role !== "client") throw new HttpError(403, "Only the client can pay for this request.");
  if (row.status === "paid") return c.json({ done: true });
  if (row.status !== "accepted") throw new HttpError(400, "This request is not ready for payment.");
  const terms = termsOf(row);
  if (!terms) throw new HttpError(400, "This request has no price yet. Wait for the advisor to accept it.");
  const advisor = await advisorById(env, cid, row.advisor_id);
  if (!advisor || advisor.status !== "approved" || !payable(env, advisor))
    throw new HttpError(400, "This person cannot take payments now. Try again later, or contact them.", "not_payable");

  // Reuse an open session, so a second click does not make a second payment.
  if (row.stripe_session_id) {
    const old = await stripe<StripeCheckoutSession>(env, "GET", `checkout/sessions/${encodeURIComponent(row.stripe_session_id)}`);
    if (old.status === "complete") {
      await fulfill(c, old);
      return c.json({ done: true });
    }
    if (old.status === "open" && old.url) return c.json({ url: old.url });
  }

  const base = appUrl(c);
  const page = `${base}${ADVISORY_HOME}/pay/${row.id}`;
  const session = await stripe<StripeCheckoutSession>(
    env,
    "POST",
    "checkout/sessions",
    checkoutForm({
      requestId: row.id,
      companyId: cid,
      advisorId: advisor.id,
      terms,
      feeBps: row.fee_bps ?? advisor.fee_bps,
      destination: advisor.stripe_account_id!,
      customerEmail: user.email,
      successUrl: `${page}?checkout=done&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: page,
      site: new URL(base).hostname
    })
  );
  if (!session.url) throw new HttpError(502, "Stripe did not start the checkout. Try again.");
  await env.DB.prepare("UPDATE advisory_requests SET stripe_session_id = ?, updated_at = ? WHERE id = ?").bind(session.id, nowIso(), row.id).run();
  return c.json({ url: session.url });
});

/** After Checkout, the payment page sends the session id here, so the engagement opens before the webhook arrives. */
paymentRoutes.post("/checkout-sync", async (c) => {
  const user = requireUser(c);
  const env = envOf(c);
  const body = await readJson(c);
  const sessionId = text(body.sessionId, "Session id", { max: 255, required: true });
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new HttpError(400, "This is not a Stripe Checkout session id.");
  const session = await stripe<StripeCheckoutSession>(env, "GET", `checkout/sessions/${sessionId}`);
  const meta = session.metadata ?? {};
  if (meta.source !== STRIPE_SOURCE || !meta.company_id || !meta.request_id) throw new HttpError(400, "This checkout is not for an Advisory payment.");
  await requirePermission(env, meta.company_id, user.id, "advisory.browse");
  const row = await env.DB.prepare("SELECT client_id FROM advisory_requests WHERE id = ? AND company_id = ?").bind(meta.request_id, meta.company_id).first<{ client_id: string }>();
  if (!row || row.client_id !== user.id) throw new HttpError(404, "This request does not exist.");
  const done = paid(session) ? await fulfill(c, session) : false;
  return c.json({ requestId: meta.request_id, done });
});

paymentRoutes.post("/stripe-webhook", async (c) => {
  const env = envOf(c);
  const secret = (env.ADVISORY_STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new HttpError(404, "Advisory payments are not set up on this site.");
  const raw = await c.req.text();
  if (!(await verifyStripeSignature(secret, c.req.header("stripe-signature"), raw))) throw new HttpError(400, "The Stripe signature is not valid.");
  let event: { type?: string; data?: { object?: unknown } };
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "The event is not JSON.");
  }
  const type = event.type ?? "";
  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    const session = event.data?.object as StripeCheckoutSession | undefined;
    if (session?.metadata?.source === STRIPE_SOURCE && paid(session)) await fulfill(c, session);
  } else if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    const sub = event.data?.object as StripeSubscriptionLite | undefined;
    if (sub?.id && sub.metadata?.source === STRIPE_SOURCE) await subscriptionChanged(env, sub, type === "customer.subscription.deleted");
  }
  return c.json({ received: true });
});

/** True when Stripe has the money, or when nothing was due (a 100% promotion code). */
const paid = (s: StripeCheckoutSession) => s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required");

/**
 * Marks the request as paid and opens the engagement. Safe to run more than once: only the first run changes anything.
 * Returns true when the request is paid, now or before.
 */
export async function fulfill(c: C, session: StripeCheckoutSession): Promise<boolean> {
  const env = envOf(c);
  const meta = session.metadata ?? {};
  const row = await env.DB.prepare("SELECT * FROM advisory_requests WHERE id = ? AND company_id = ?").bind(meta.request_id ?? "", meta.company_id ?? "").first<RequestRow>();
  if (!row) {
    console.warn("[openact] An Advisory payment has no request. It was not saved.", session.id);
    return false;
  }
  if (row.status === "paid") return true;
  const terms = termsOf(row);
  if (!terms) return false;
  const iso = nowIso();
  // The payment wins, even if the client or the advisor closed the request while Checkout was open.
  const res = await env.DB.prepare("UPDATE advisory_requests SET status = 'paid', paid_at = ?, stripe_session_id = ?, updated_at = ? WHERE id = ? AND status != 'paid'")
    .bind(iso, session.id, iso, row.id)
    .run();
  if (!res.meta.changes) return true;

  const advisor = await advisorById(env, row.company_id, row.advisor_id);
  const client = await env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(row.client_id).first<{ name: string; email: string }>();
  const engagementId = newId();
  const fee = applicationFee(terms.price.amount, row.fee_bps ?? advisor?.fee_bps ?? 0);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO advisory_engagements (id, company_id, request_id, advisor_id, client_id, terms_name, terms_price_cents, terms_currency, terms_kind, fee_cents,
       stripe_session_id, stripe_payment_intent_id, stripe_subscription_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(
      engagementId,
      row.company_id,
      row.id,
      row.advisor_id,
      row.client_id,
      terms.name,
      terms.price.amount,
      terms.price.currency,
      terms.kind,
      fee,
      session.id,
      idOf(session.payment_intent),
      idOf(session.subscription),
      iso,
      iso
    )
    .run();

  // The engagement project: secret, the advisor owns it, the client works in it.
  let projectPath: string | null = null;
  if (advisor) {
    try {
      const p = await createProject(env, {
        companyId: row.company_id,
        name: engagementProjectName(client?.name || client?.email || "Client", terms.name),
        description: `Advisory engagement between ${advisor.name || advisor.email} and ${client?.name || client?.email || "the client"}.`,
        visibility: "secret",
        color: "teal",
        ownerId: advisor.user_id,
        members: [{ userId: row.client_id, role: "editor" }]
      });
      projectPath = p.path;
      await env.DB.prepare("UPDATE advisory_engagements SET project_id = ?, updated_at = ? WHERE request_id = ?").bind(p.id, nowIso(), row.id).run();
    } catch (e) {
      // The payment is saved. A manager can make the project by hand.
      console.warn("[openact] Advisory could not open the engagement project", e instanceof Error ? e.message : "unknown");
    }
  }

  const base = appUrl(c);
  const defer = (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
  const url = `${base}${projectPath ?? `${ADVISORY_HOME}/my`}`;
  if (client) send(env, engagementEmail(env, { to: client.email, other: advisor?.name || "your advisor", offer: terms.name, url }), defer);
  if (advisor) send(env, engagementEmail(env, { to: advisor.email, other: client?.name || client?.email || "your client", offer: terms.name, url }), defer);
  return true;
}

/** A retainer changed in Stripe. A canceled retainer ends the engagement. The project and its data stay. */
async function subscriptionChanged(env: AdvisoryEnv, sub: StripeSubscriptionLite, deleted: boolean): Promise<void> {
  const status = deleted ? "ended" : engagementStatusFor(sub.status);
  const iso = nowIso();
  await env.DB.prepare(
    `UPDATE advisory_engagements SET status = ?, ended_at = CASE WHEN ? = 'ended' THEN COALESCE(ended_at, ?) ELSE NULL END, updated_at = ?
     WHERE stripe_subscription_id = ? OR (stripe_subscription_id IS NULL AND request_id = ?)`
  )
    .bind(status, status, iso, iso, sub.id, sub.metadata?.request_id ?? "")
    .run();
}
