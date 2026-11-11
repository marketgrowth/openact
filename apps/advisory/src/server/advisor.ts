import { Hono, type Context } from "hono";
import { HttpError, appUrl, newId, nowIso, oneOf, readJson, requirePermission, requireUser, text, type AppEnv } from "@openact/core/server";
import { ADVISORY_HOME, LIMITS, formatPrice, percentToBps, priceProblem, sniffPhoto } from "../shared/rules";
import { OFFER_KINDS, type MyAdvisorPage, type OfferKind } from "../shared/types";
import {
  advisorByUser,
  feePercent,
  loadEngagements,
  loadRequests,
  loadSettings,
  managerEmails,
  offersOf,
  paymentsOn,
  photoUrl,
  toOffer,
  type AdvisorRow,
  type AdvisoryEnv,
  type OfferRow,
  type RequestRow
} from "./data";
import { accountReady, stripe, type StripeAccount } from "./stripe";
import { applicationEmail, declinedEmail, paymentLinkEmail, send } from "./emails";

/*
 * The advisor dashboard: the person's own profile, offers, Stripe account, requests and clients.
 * Every route checks "advisory.sell". A person has one advisor profile per company.
 */

type C = Context<AppEnv>;
const envOf = (c: C) => c.env as AdvisoryEnv;
const defer = (c: C) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

async function seller(c: C): Promise<{ cid: string; userId: string; env: AdvisoryEnv }> {
  const user = requireUser(c);
  const cid = c.req.param("cid")!;
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.sell");
  return { cid, userId: user.id, env };
}

async function myAdvisor(c: C): Promise<{ cid: string; userId: string; env: AdvisoryEnv; a: AdvisorRow }> {
  const s = await seller(c);
  const a = await advisorByUser(s.env, s.cid, s.userId);
  if (!a) throw new HttpError(404, "You have no profile yet. Write your profile first.");
  return { ...s, a };
}

const touch = (c: C, advisorId: string) => envOf(c).DB.prepare("UPDATE advisory_advisors SET updated_at = ? WHERE id = ?").bind(nowIso(), advisorId);

export const advisorRoutes = new Hono<AppEnv>();

advisorRoutes.get("/companies/:cid/me", async (c) => {
  const { cid, userId, env } = await seller(c);
  const [settings, a] = await Promise.all([loadSettings(env, cid), advisorByUser(env, cid, userId)]);
  let advisor: MyAdvisorPage["advisor"] = null;
  let pending = 0;
  if (a) {
    const [offers, count] = await Promise.all([
      offersOf(env, [a.id]),
      env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_requests WHERE advisor_id = ? AND status = 'pending'").bind(a.id).first<{ n: number }>()
    ]);
    pending = count?.n ?? 0;
    advisor = {
      id: a.id,
      status: a.status,
      headline: a.headline,
      bio: a.bio,
      photoUrl: photoUrl(a),
      feePercent: feePercent(a),
      declineNote: a.decline_note,
      stripe: { connected: !!a.stripe_account_id, ready: a.stripe_ready === 1 },
      offers: offers.map(toOffer)
    };
  }
  const page: MyAdvisorPage = { settings, advisor, payments: paymentsOn(env), counts: { pending } };
  return c.json(page);
});

/** Writes the profile. The first save makes a draft with the brand's default fee. */
advisorRoutes.put("/companies/:cid/me/profile", async (c) => {
  const { cid, userId, env } = await seller(c);
  const body = await readJson(c);
  const headline = text(body.headline, "Role", { max: LIMITS.headline, required: true });
  const bio = text(body.bio, "Bio", { max: LIMITS.bio });
  const iso = nowIso();
  const existing = await advisorByUser(env, cid, userId);
  if (existing) {
    await env.DB.prepare("UPDATE advisory_advisors SET headline = ?, bio = ?, updated_at = ? WHERE id = ?").bind(headline, bio, iso, existing.id).run();
    return c.json({ id: existing.id });
  }
  const settings = await loadSettings(env, cid);
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO advisory_advisors (id, company_id, user_id, status, headline, bio, fee_bps, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)"
  )
    .bind(id, cid, userId, headline, bio, percentToBps(settings.defaultFeePercent), iso, iso)
    .run();
  return c.json({ id }, 201);
});

advisorRoutes.post("/companies/:cid/me/photo", async (c) => {
  const { cid, env, a } = await myAdvisor(c);
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "Choose a photo to upload.");
  if (file.size > LIMITS.photoBytes) throw new HttpError(400, "The photo is too large. Use a photo of 2 MB or less.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffPhoto(bytes);
  if (!type) throw new HttpError(400, "Use a PNG, JPEG or WebP photo.");
  const key = `advisory/${cid}/${a.id}/photo-${newId()}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare("UPDATE advisory_advisors SET photo_key = ?, photo_type = ?, updated_at = ? WHERE id = ?").bind(key, type, nowIso(), a.id).run();
  if (a.photo_key) await env.FILES.delete(a.photo_key);
  return c.json({ ok: true });
});

advisorRoutes.delete("/companies/:cid/me/photo", async (c) => {
  const { env, a } = await myAdvisor(c);
  if (a.photo_key) await env.FILES.delete(a.photo_key);
  await env.DB.prepare("UPDATE advisory_advisors SET photo_key = NULL, photo_type = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), a.id).run();
  return c.json({ ok: true });
});

/** Sends the profile for review. With auto-approve on, it goes live now. */
advisorRoutes.post("/companies/:cid/me/submit", async (c) => {
  const { cid, env, a } = await myAdvisor(c);
  if (a.status === "approved") throw new HttpError(400, "Your profile is already live.");
  if (a.status === "pending") throw new HttpError(400, "Your profile is already waiting for review.");
  if (a.status === "paused") throw new HttpError(400, "Your profile is paused. Ask a company owner or admin to turn it back on.");
  if (!a.headline.trim()) throw new HttpError(400, "Add your role before you apply.");
  if (!a.bio.trim()) throw new HttpError(400, "Add a short bio before you apply.");
  const offers = await offersOf(env, [a.id]);
  if (!offers.length) throw new HttpError(400, "Add at least one offer before you apply.");
  const settings = await loadSettings(env, cid);
  const iso = nowIso();
  const auto = settings.approvalMode === "auto";
  await env.DB.prepare(
    `UPDATE advisory_advisors SET status = ?, submitted_at = ?, decline_note = '', updated_at = ?${auto ? ", decided_at = ?, decided_by = NULL" : ""} WHERE id = ?`
  )
    .bind(...(auto ? ["approved", iso, iso, iso, a.id] : ["pending", iso, iso, a.id]))
    .run();
  if (!auto) {
    const url = `${appUrl(c)}${ADVISORY_HOME}/manage`;
    for (const to of await managerEmails(env, cid)) send(env, applicationEmail(env, { to, name: a.name || a.email, label: settings.label, url }), defer(c));
  }
  return c.json({ status: auto ? "approved" : "pending" });
});

/* Offers */

function offerInput(body: Record<string, unknown>, partial: boolean) {
  const out: { name?: string; description?: string; price?: number; kind?: OfferKind } = {};
  if (!partial || body.name !== undefined) out.name = text(body.name, "Offer name", { max: LIMITS.offerName, required: true });
  if (!partial || body.description !== undefined) out.description = text(body.description, "Description", { max: LIMITS.offerDescription });
  if (!partial || body.price !== undefined) {
    const p = priceProblem(body.price);
    if (p) throw new HttpError(400, p);
    out.price = body.price as number;
  }
  if (!partial || body.kind !== undefined) out.kind = oneOf(body.kind, "Offer type", OFFER_KINDS);
  return out;
}

advisorRoutes.post("/companies/:cid/me/offers", async (c) => {
  const { cid, env, a } = await myAdvisor(c);
  const o = offerInput(await readJson(c), false);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM advisory_offers WHERE advisor_id = ? AND status = 'active'")
    .bind(a.id)
    .first<{ n: number; pos: number }>();
  if ((count?.n ?? 0) >= LIMITS.offersPerAdvisor) throw new HttpError(400, `You can have up to ${LIMITS.offersPerAdvisor} offers. Archive one first.`);
  const settings = await loadSettings(env, cid);
  const id = newId();
  const iso = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO advisory_offers (id, company_id, advisor_id, name, description, price_cents, currency, kind, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)"
    ).bind(id, cid, a.id, o.name, o.description, o.price, settings.currency, o.kind, (count?.pos ?? 0) + 1000, iso, iso),
    touch(c, a.id)
  ]);
  return c.json({ id }, 201);
});

advisorRoutes.patch("/companies/:cid/me/offers/:oid", async (c) => {
  const { env, a } = await myAdvisor(c);
  const o = offerInput(await readJson(c), true);
  const row = await env.DB.prepare("SELECT id FROM advisory_offers WHERE id = ? AND advisor_id = ? AND status = 'active'").bind(c.req.param("oid"), a.id).first();
  if (!row) throw new HttpError(404, "This offer does not exist. You may have archived it.");
  const sets: string[] = [];
  const binds: unknown[] = [];
  const cols = { name: "name", description: "description", price: "price_cents", kind: "kind" } as const;
  for (const [k, col] of Object.entries(cols) as Array<[keyof typeof cols, string]>) {
    if (o[k] !== undefined) {
      sets.push(`${col} = ?`);
      binds.push(o[k]);
    }
  }
  if (!sets.length) return c.json({ ok: true });
  // A price change applies to new purchases only. Accepted requests keep the price they show.
  await env.DB.batch([
    env.DB.prepare(`UPDATE advisory_offers SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...binds, nowIso(), c.req.param("oid")),
    touch(c, a.id)
  ]);
  return c.json({ ok: true });
});

advisorRoutes.delete("/companies/:cid/me/offers/:oid", async (c) => {
  const { env, a } = await myAdvisor(c);
  const res = await env.DB.prepare("UPDATE advisory_offers SET status = 'archived', updated_at = ? WHERE id = ? AND advisor_id = ? AND status = 'active'")
    .bind(nowIso(), c.req.param("oid"), a.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, "This offer does not exist. You may have archived it.");
  return c.json({ ok: true });
});

/* Stripe Connect */

/** Starts or continues Stripe onboarding. Makes an Express account the first time. */
advisorRoutes.post("/companies/:cid/me/stripe/connect", async (c) => {
  const { cid, env, a } = await myAdvisor(c);
  let account = a.stripe_account_id;
  if (!account) {
    const made = await stripe<StripeAccount>(
      env,
      "POST",
      "accounts",
      new URLSearchParams({
        type: "express",
        email: a.email,
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
        "metadata[source]": "openact-advisory",
        "metadata[company_id]": cid,
        "metadata[advisor_id]": a.id
      })
    );
    account = made.id;
    await env.DB.prepare("UPDATE advisory_advisors SET stripe_account_id = ?, stripe_ready = 0, updated_at = ? WHERE id = ?").bind(account, nowIso(), a.id).run();
  }
  const back = `${appUrl(c)}${ADVISORY_HOME}/me?tab=earnings&stripe=back`;
  const link = await stripe<{ url?: string }>(
    env,
    "POST",
    "account_links",
    new URLSearchParams({ account, type: "account_onboarding", refresh_url: `${appUrl(c)}${ADVISORY_HOME}/me?tab=earnings&stripe=retry`, return_url: back })
  );
  if (!link.url) throw new HttpError(502, "Stripe did not start the setup. Try again.");
  return c.json({ url: link.url });
});

/** Reads the connected account from Stripe and saves whether it can take payments. */
advisorRoutes.post("/companies/:cid/me/stripe/refresh", async (c) => {
  const { env, a } = await myAdvisor(c);
  if (!a.stripe_account_id) return c.json({ connected: false, ready: false });
  const acct = await stripe<StripeAccount>(env, "GET", `accounts/${encodeURIComponent(a.stripe_account_id)}`);
  const ready = accountReady(acct);
  await env.DB.prepare("UPDATE advisory_advisors SET stripe_ready = ?, updated_at = ? WHERE id = ?").bind(ready ? 1 : 0, nowIso(), a.id).run();
  return c.json({ connected: true, ready });
});

/** A one-time link to the advisor's Stripe Express dashboard, for payouts and tax forms. */
advisorRoutes.post("/companies/:cid/me/stripe/dashboard", async (c) => {
  const { env, a } = await myAdvisor(c);
  if (!a.stripe_account_id || a.stripe_ready !== 1) throw new HttpError(400, "Finish your Stripe setup first.");
  const link = await stripe<{ url?: string }>(env, "POST", `accounts/${encodeURIComponent(a.stripe_account_id)}/login_links`);
  if (!link.url) throw new HttpError(502, "Stripe did not open the dashboard. Try again.");
  return c.json({ url: link.url });
});

/* Requests and clients */

advisorRoutes.get("/companies/:cid/me/requests", async (c) => {
  const { cid, env, a } = await myAdvisor(c);
  return c.json({ requests: await loadRequests(env, "r.company_id = ? AND r.advisor_id = ?", [cid, a.id], true) });
});

async function myRequest(c: C) {
  const s = await myAdvisor(c);
  const row = await s.env.DB.prepare("SELECT * FROM advisory_requests WHERE id = ? AND advisor_id = ? AND company_id = ?")
    .bind(c.req.param("rid"), s.a.id, s.cid)
    .first<RequestRow & { client_email: string }>();
  if (!row) throw new HttpError(404, "This request does not exist.");
  const client = await s.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(row.client_id).first<{ email: string }>();
  return { ...s, row, clientEmail: client?.email ?? "" };
}

/** Accepts a request with one of the advisor's offers or a custom price. The client gets the payment page link. */
advisorRoutes.post("/companies/:cid/me/requests/:rid/accept", async (c) => {
  const { cid, env, a, row, clientEmail } = await myRequest(c);
  if (row.status !== "pending") throw new HttpError(400, "This request is not waiting for a reply.");
  if (a.status !== "approved") throw new HttpError(400, "Your profile is not live, so you cannot accept requests now.");
  const body = await readJson(c);
  let terms: { name: string; price: number; currency: string; kind: OfferKind; offerId: string | null };
  if (typeof body.offerId === "string" && body.offerId) {
    const o = await env.DB.prepare("SELECT * FROM advisory_offers WHERE id = ? AND advisor_id = ? AND status = 'active'").bind(body.offerId, a.id).first<OfferRow>();
    if (!o) throw new HttpError(400, "This offer is not available. Choose another one.");
    terms = { name: o.name, price: o.price_cents, currency: o.currency, kind: o.kind, offerId: o.id };
  } else {
    const custom = (body.custom ?? {}) as Record<string, unknown>;
    const o = offerInput(custom, false);
    const settings = await loadSettings(env, cid);
    terms = { name: o.name!, price: o.price!, currency: settings.currency, kind: o.kind!, offerId: null };
  }
  const iso = nowIso();
  const res = await env.DB.prepare(
    `UPDATE advisory_requests SET status = 'accepted', offer_id = COALESCE(?, offer_id), terms_name = ?, terms_price_cents = ?, terms_currency = ?, terms_kind = ?,
       fee_bps = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`
  )
    .bind(terms.offerId, terms.name, terms.price, terms.currency, terms.kind, a.fee_bps, iso, iso, row.id)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "The client changed this request. Reload the page.");
  send(
    env,
    paymentLinkEmail(env, {
      to: clientEmail,
      advisorName: a.name || a.email,
      offer: terms.name,
      price: formatPrice({ amount: terms.price, currency: terms.currency }, terms.kind),
      url: `${appUrl(c)}${ADVISORY_HOME}/pay/${row.id}`
    }),
    defer(c)
  );
  return c.json({ ok: true, payPath: `${ADVISORY_HOME}/pay/${row.id}` });
});

advisorRoutes.post("/companies/:cid/me/requests/:rid/decline", async (c) => {
  const { env, a, row, clientEmail } = await myRequest(c);
  if (row.status !== "pending" && row.status !== "accepted") throw new HttpError(400, "This request is already closed.");
  const body = await readJson(c);
  const note = text(body.note, "Note", { max: LIMITS.note });
  const iso = nowIso();
  const res = await env.DB.prepare(
    "UPDATE advisory_requests SET status = 'declined', decline_note = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'accepted')"
  )
    .bind(note, iso, iso, row.id)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "This request changed. Reload the page.");
  send(env, declinedEmail(env, { to: clientEmail, advisorName: a.name || a.email, note, url: `${appUrl(c)}${ADVISORY_HOME}` }), defer(c));
  return c.json({ ok: true });
});

advisorRoutes.get("/companies/:cid/me/engagements", async (c) => {
  const { cid, env, a } = await myAdvisor(c);
  return c.json({ engagements: await loadEngagements(env, "e.company_id = ? AND e.advisor_id = ?", [cid, a.id]) });
});
