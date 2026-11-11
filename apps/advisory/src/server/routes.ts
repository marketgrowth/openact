import { Hono, type Context } from "hono";
import { HttpError, appUrl, hasPermission, newId, nowIso, readJson, requirePermission, requireUser, text, type AppEnv } from "@openact/core/server";
import { ADVISORY_HOME, LIMITS } from "../shared/rules";
import type { AdvisorProfile, AdvisoryHome, AdvisoryRequest } from "../shared/types";
import {
  advisorById,
  advisorByUser,
  advisoryCan,
  listedAdvisors,
  loadRequests,
  loadSettings,
  offersOf,
  payable,
  paymentsOn,
  requireListedAdvisor,
  toCard,
  toOffer,
  type AdvisoryEnv,
  type OfferRow,
  type RequestRow
} from "./data";
import { newRequestEmail, send } from "./emails";

/*
 * Advisory for members: the directory, profiles, consult requests, pay in advance and their own requests.
 * Every route checks "advisory.browse" through requirePermission, so the person must be in the company,
 * Advisory must be on, and the company must have OpenAct Director.
 */

type C = Context<AppEnv>;
const envOf = (c: C) => c.env as AdvisoryEnv;
const defer = (c: C) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

export const clientRoutes = new Hono<AppEnv>();

clientRoutes.get("/companies/:cid/home", async (c) => {
  const user = requireUser(c);
  const cid = c.req.param("cid");
  const env = envOf(c);
  const can = await advisoryCan(env, cid, user.id);
  const [settings, advisors, mine] = await Promise.all([loadSettings(env, cid), listedAdvisors(env, cid), advisorByUser(env, cid, user.id)]);
  const offers = await offersOf(env, advisors.map((a) => a.id));
  const home: AdvisoryHome = {
    settings,
    advisors: advisors.map((a) => toCard(env, a, offers)),
    can,
    myStatus: mine?.status ?? null,
    payments: paymentsOn(env)
  };
  return c.json(home);
});

clientRoutes.get("/companies/:cid/advisors/:aid", async (c) => {
  const user = requireUser(c);
  const cid = c.req.param("cid");
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.browse");
  const a = await requireListedAdvisor(env, cid, c.req.param("aid"), user.id);
  const offers = await offersOf(env, [a.id]);
  const profile: AdvisorProfile = { ...toCard(env, a, offers), bio: a.bio, offers: offers.map(toOffer), isMe: a.user_id === user.id };
  return c.json(profile);
});

clientRoutes.get("/companies/:cid/advisors/:aid/photo", async (c) => {
  const user = requireUser(c);
  const cid = c.req.param("cid");
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.browse");
  const a = await advisorById(env, cid, c.req.param("aid"));
  // Members see photos of listed advisors. The advisor and the managers also see photos of profiles under review.
  const allowed = a && (a.status === "approved" || a.user_id === user.id || (await hasPermission(env, cid, user.id, "advisory.manage")));
  if (!a || !allowed || !a.photo_key) throw new HttpError(404, "This photo does not exist.");
  const obj = await env.FILES.get(a.photo_key);
  if (!obj) throw new HttpError(404, "This photo does not exist.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": a.photo_type || "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff"
    }
  });
});

/** Book a consult: the client sends a request. The advisor accepts with an offer or a custom price, or declines. */
clientRoutes.post("/companies/:cid/advisors/:aid/requests", async (c) => {
  const user = requireUser(c);
  const cid = c.req.param("cid");
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.browse");
  const a = await requireListedAdvisor(env, cid, c.req.param("aid"), user.id);
  if (a.user_id === user.id) throw new HttpError(400, "You cannot send a request to yourself.");
  if (a.status !== "approved") throw new HttpError(400, "This profile is not listed now, so it cannot take requests.");
  const body = await readJson(c);
  const message = text(body.message, "Message", { max: LIMITS.message, required: true });
  let offerId: string | null = null;
  if (body.offerId !== undefined && body.offerId !== null && body.offerId !== "") {
    if (typeof body.offerId !== "string") throw new HttpError(400, "The offer is not valid.");
    const o = await env.DB.prepare("SELECT id FROM advisory_offers WHERE id = ? AND advisor_id = ? AND status = 'active'").bind(body.offerId, a.id).first();
    if (!o) throw new HttpError(400, "This offer is not available now. Choose another one, or leave it empty.");
    offerId = body.offerId;
  }
  const open = await env.DB.prepare(
    "SELECT id FROM advisory_requests WHERE company_id = ? AND advisor_id = ? AND client_id = ? AND source = 'request' AND status = 'pending'"
  )
    .bind(cid, a.id, user.id)
    .first();
  if (open) throw new HttpError(409, "You already have an open request with this person. Wait for a reply, or cancel it on My requests.");
  const id = newId();
  const iso = nowIso();
  await env.DB.prepare(
    "INSERT INTO advisory_requests (id, company_id, advisor_id, client_id, source, status, message, offer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'request', 'pending', ?, ?, ?, ?)"
  )
    .bind(id, cid, a.id, user.id, message, offerId, iso, iso)
    .run();
  send(env, newRequestEmail(env, { to: a.email, clientName: user.name || user.email, url: `${appUrl(c)}${ADVISORY_HOME}/me?tab=requests` }), defer(c));
  return c.json({ id }, 201);
});

/** Pay in advance: the client picks an offer. The request starts as accepted, and the payment page takes it from there. */
clientRoutes.post("/companies/:cid/advisors/:aid/offers/:oid/buy", async (c) => {
  const user = requireUser(c);
  const cid = c.req.param("cid");
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.browse");
  const a = await requireListedAdvisor(env, cid, c.req.param("aid"), user.id);
  if (a.user_id === user.id) throw new HttpError(400, "You cannot buy your own offer.");
  if (!payable(env, a)) throw new HttpError(400, "This person cannot take payments yet. Book a consult instead.", "not_payable");
  const o = await env.DB.prepare("SELECT * FROM advisory_offers WHERE id = ? AND advisor_id = ? AND status = 'active'").bind(c.req.param("oid"), a.id).first<OfferRow>();
  if (!o) throw new HttpError(404, "This offer is not available now. Choose another one.");
  // Opening the same offer again reuses the unpaid purchase, so the client does not collect duplicates.
  const again = await env.DB.prepare(
    "SELECT id FROM advisory_requests WHERE company_id = ? AND advisor_id = ? AND client_id = ? AND offer_id = ? AND source = 'direct' AND status = 'accepted' AND terms_price_cents = ?"
  )
    .bind(cid, a.id, user.id, o.id, o.price_cents)
    .first<{ id: string }>();
  if (again) return c.json({ id: again.id });
  const id = newId();
  const iso = nowIso();
  await env.DB.prepare(
    `INSERT INTO advisory_requests (id, company_id, advisor_id, client_id, source, status, message, offer_id, terms_name, terms_price_cents, terms_currency, terms_kind, fee_bps, created_at, updated_at, decided_at)
     VALUES (?, ?, ?, ?, 'direct', 'accepted', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, cid, a.id, user.id, o.id, o.name, o.price_cents, o.currency, o.kind, a.fee_bps, iso, iso, iso)
    .run();
  return c.json({ id }, 201);
});

clientRoutes.get("/companies/:cid/my/requests", async (c) => {
  const user = requireUser(c);
  const cid = c.req.param("cid");
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.browse");
  const requests = await loadRequests(env, "r.company_id = ? AND r.client_id = ?", [cid, user.id], false);
  return c.json({ requests });
});

/** One request, for the payment page. The client, the advisor and the managers can read it. */
export async function readRequest(c: C, cid: string, rid: string): Promise<{ request: AdvisoryRequest; row: RequestRow; role: "client" | "advisor" | "manager" }> {
  const user = requireUser(c);
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.browse");
  const row = await env.DB.prepare("SELECT * FROM advisory_requests WHERE id = ? AND company_id = ?").bind(rid, cid).first<RequestRow>();
  if (!row) throw new HttpError(404, "This request does not exist.");
  let role: "client" | "advisor" | "manager" | null = row.client_id === user.id ? "client" : null;
  if (!role) {
    const mine = await advisorByUser(env, cid, user.id);
    if (mine?.id === row.advisor_id) role = "advisor";
  }
  if (!role && (await hasPermission(env, cid, user.id, "advisory.manage"))) role = "manager";
  if (!role) throw new HttpError(404, "This request does not exist.");
  const [request] = await loadRequests(env, "r.id = ? AND r.company_id = ?", [rid, cid], role !== "client");
  return { request: request!, row, role };
}

clientRoutes.get("/companies/:cid/requests/:rid", async (c) => {
  const cid = c.req.param("cid");
  const env = envOf(c);
  const { request, row, role } = await readRequest(c, cid, c.req.param("rid"));
  const advisor = await advisorById(env, cid, row.advisor_id);
  return c.json({ request, role, payable: !!advisor && advisor.status === "approved" && payable(env, advisor), settings: await loadSettings(env, cid) });
});

clientRoutes.post("/companies/:cid/requests/:rid/cancel", async (c) => {
  const cid = c.req.param("cid");
  const env = envOf(c);
  const { row, role } = await readRequest(c, cid, c.req.param("rid"));
  if (role !== "client") throw new HttpError(403, "Only the person who sent the request can cancel it.");
  if (row.status !== "pending" && row.status !== "accepted") throw new HttpError(400, "This request is already closed.");
  const iso = nowIso();
  await env.DB.prepare("UPDATE advisory_requests SET status = 'canceled', updated_at = ?, decided_at = COALESCE(decided_at, ?) WHERE id = ? AND status IN ('pending', 'accepted')")
    .bind(iso, iso, row.id)
    .run();
  return c.json({ ok: true });
});
