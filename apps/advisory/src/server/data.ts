import { HttpError, hasPermission, requirePermission, type Env } from "@openact/core/server";
import { bpsToPercent, readSettings } from "../shared/rules";
import type {
  AdvisorCard,
  AdvisorStatus,
  AdvisorySettings,
  AdvisoryRequest,
  Engagement,
  EngagementStatus,
  Offer,
  OfferKind,
  RequestSource,
  RequestStatus,
  Terms
} from "../shared/types";

/*
 * Rows, loaders and mappers for Advisory. Every query is scoped to one company.
 */

/** The Worker env with the Advisory secrets. */
export type AdvisoryEnv = Env & {
  /** The Stripe secret key of the brand's platform account (Stripe Connect). Advisory takes payments only when it is set. */
  ADVISORY_STRIPE_SECRET_KEY?: string;
  /** The signing secret of the Advisory webhook endpoint (whsec_...). */
  ADVISORY_STRIPE_WEBHOOK_SECRET?: string;
};

export const API = "/api/apps/advisory";

export const paymentsOn = (env: AdvisoryEnv) => !!(env.ADVISORY_STRIPE_SECRET_KEY || "").trim();

export interface AdvisorRow {
  id: string;
  company_id: string;
  user_id: string;
  status: AdvisorStatus;
  headline: string;
  bio: string;
  photo_key: string | null;
  photo_type: string | null;
  fee_bps: number;
  stripe_account_id: string | null;
  stripe_ready: number;
  decline_note: string;
  submitted_at: string | null;
  updated_at: string;
  name: string;
  email: string;
}

export interface OfferRow {
  id: string;
  company_id: string;
  advisor_id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  kind: OfferKind;
  status: "active" | "archived";
  position: number;
}

export interface RequestRow {
  id: string;
  company_id: string;
  advisor_id: string;
  client_id: string;
  source: RequestSource;
  status: RequestStatus;
  message: string;
  offer_id: string | null;
  terms_name: string | null;
  terms_price_cents: number | null;
  terms_currency: string | null;
  terms_kind: OfferKind | null;
  fee_bps: number | null;
  decline_note: string;
  stripe_session_id: string | null;
  created_at: string;
  decided_at: string | null;
  paid_at: string | null;
}

export interface EngagementRow {
  id: string;
  company_id: string;
  request_id: string;
  advisor_id: string;
  client_id: string;
  terms_name: string;
  terms_price_cents: number;
  terms_currency: string;
  terms_kind: OfferKind;
  fee_cents: number;
  project_id: string | null;
  status: EngagementStatus;
  created_at: string;
  ended_at: string | null;
}

export async function loadSettings(env: Env, companyId: string): Promise<AdvisorySettings> {
  const row = await env.DB.prepare("SELECT label, label_plural, approval_mode, default_fee_bps, currency FROM advisory_settings WHERE company_id = ?")
    .bind(companyId)
    .first<{ label: string | null; label_plural: string | null; approval_mode: string; default_fee_bps: number; currency: string }>();
  return readSettings(row);
}

const ADVISOR_SELECT = `SELECT a.*, u.name AS name, u.email AS email FROM advisory_advisors a JOIN users u ON u.id = a.user_id`;

export async function advisorById(env: Env, companyId: string, advisorId: string): Promise<AdvisorRow | null> {
  return env.DB.prepare(`${ADVISOR_SELECT} WHERE a.id = ? AND a.company_id = ?`).bind(advisorId, companyId).first<AdvisorRow>();
}

export async function advisorByUser(env: Env, companyId: string, userId: string): Promise<AdvisorRow | null> {
  return env.DB.prepare(`${ADVISOR_SELECT} WHERE a.company_id = ? AND a.user_id = ?`).bind(companyId, userId).first<AdvisorRow>();
}

export async function listedAdvisors(env: Env, companyId: string): Promise<AdvisorRow[]> {
  const rows = await env.DB.prepare(`${ADVISOR_SELECT} WHERE a.company_id = ? AND a.status = 'approved' ORDER BY u.name COLLATE NOCASE`).bind(companyId).all<AdvisorRow>();
  return rows.results;
}

/** The advisor, when the profile is listed. Members see only approved advisors. The advisor sees their own. */
export async function requireListedAdvisor(env: Env, companyId: string, advisorId: string, userId: string): Promise<AdvisorRow> {
  const a = await advisorById(env, companyId, advisorId);
  if (!a || (a.status !== "approved" && a.user_id !== userId)) throw new HttpError(404, "This profile does not exist, or it is not listed now.");
  return a;
}

export async function offersOf(env: Env, advisorIds: string[], activeOnly = true): Promise<OfferRow[]> {
  if (!advisorIds.length) return [];
  const rows = await env.DB.prepare(
    `SELECT * FROM advisory_offers WHERE advisor_id IN (${advisorIds.map(() => "?").join(", ")})${activeOnly ? " AND status = 'active'" : ""} ORDER BY position, created_at`
  )
    .bind(...advisorIds)
    .all<OfferRow>();
  return rows.results;
}

export const photoUrl = (a: Pick<AdvisorRow, "id" | "company_id" | "photo_key" | "updated_at">) =>
  a.photo_key ? `${API}/companies/${a.company_id}/advisors/${a.id}/photo?v=${encodeURIComponent(a.photo_key.split("/").pop() ?? "")}` : null;

export const toOffer = (o: OfferRow): Offer => ({
  id: o.id,
  name: o.name,
  description: o.description,
  price: { amount: o.price_cents, currency: o.currency },
  kind: o.kind,
  status: o.status
});

/** An advisor can take payments when this site has Stripe and their connected account is ready. */
export const payable = (env: AdvisoryEnv, a: Pick<AdvisorRow, "stripe_account_id" | "stripe_ready">) => paymentsOn(env) && !!a.stripe_account_id && a.stripe_ready === 1;

export function toCard(env: AdvisoryEnv, a: AdvisorRow, offers: OfferRow[]): AdvisorCard {
  const mine = offers.filter((o) => o.advisor_id === a.id && o.status === "active");
  const low = mine.reduce<OfferRow | null>((m, o) => (!m || o.price_cents < m.price_cents ? o : m), null);
  return {
    id: a.id,
    userId: a.user_id,
    name: a.name,
    headline: a.headline,
    photoUrl: photoUrl(a),
    fromPrice: low ? { amount: low.price_cents, currency: low.currency, kind: low.kind } : null,
    payable: payable(env, a)
  };
}

export function termsOf(r: Pick<RequestRow, "terms_name" | "terms_price_cents" | "terms_currency" | "terms_kind">): Terms | null {
  if (!r.terms_name || r.terms_price_cents === null || !r.terms_currency || !r.terms_kind) return null;
  return { name: r.terms_name, price: { amount: r.terms_price_cents, currency: r.terms_currency }, kind: r.terms_kind };
}

/** Requests with names and their engagement. `where` is scoped by the caller and must include the company. */
export async function loadRequests(env: Env, where: string, binds: unknown[], showEmail: boolean): Promise<AdvisoryRequest[]> {
  const rows = await env.DB.prepare(
    `SELECT r.*, ua.name AS advisor_name, a.headline AS advisor_headline, uc.name AS client_name, uc.email AS client_email,
            e.id AS engagement_id, e.status AS engagement_status, e.project_id AS engagement_project
     FROM advisory_requests r
     JOIN advisory_advisors a ON a.id = r.advisor_id
     JOIN users ua ON ua.id = a.user_id
     JOIN users uc ON uc.id = r.client_id
     LEFT JOIN advisory_engagements e ON e.request_id = r.id
     WHERE ${where}
     ORDER BY r.created_at DESC LIMIT 200`
  )
    .bind(...binds)
    .all<
      RequestRow & {
        advisor_name: string;
        advisor_headline: string;
        client_name: string;
        client_email: string;
        engagement_id: string | null;
        engagement_status: EngagementStatus | null;
        engagement_project: string | null;
      }
    >();
  return rows.results.map((r) => ({
    id: r.id,
    source: r.source,
    status: r.status,
    advisor: { id: r.advisor_id, name: r.advisor_name, headline: r.advisor_headline },
    client: { id: r.client_id, name: r.client_name, email: showEmail ? r.client_email : null },
    message: r.message,
    offerId: r.offer_id,
    terms: termsOf(r),
    declineNote: r.decline_note,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    paidAt: r.paid_at,
    engagement: r.engagement_id
      ? { id: r.engagement_id, status: r.engagement_status ?? "active", projectPath: r.engagement_project ? `/p/${r.engagement_project}` : null }
      : null
  }));
}

export async function loadEngagements(env: Env, where: string, binds: unknown[]): Promise<Engagement[]> {
  const rows = await env.DB.prepare(
    `SELECT e.*, uc.name AS client_name, ua.name AS advisor_name
     FROM advisory_engagements e
     JOIN advisory_advisors a ON a.id = e.advisor_id
     JOIN users ua ON ua.id = a.user_id
     JOIN users uc ON uc.id = e.client_id
     WHERE ${where}
     ORDER BY e.created_at DESC LIMIT 500`
  )
    .bind(...binds)
    .all<EngagementRow & { client_name: string; advisor_name: string }>();
  return rows.results.map((e) => ({
    id: e.id,
    requestId: e.request_id,
    status: e.status,
    client: { id: e.client_id, name: e.client_name },
    advisor: { id: e.advisor_id, name: e.advisor_name },
    terms: { name: e.terms_name, price: { amount: e.terms_price_cents, currency: e.terms_currency }, kind: e.terms_kind },
    fee: { amount: e.fee_cents, currency: e.terms_currency },
    projectPath: e.project_id ? `/p/${e.project_id}` : null,
    createdAt: e.created_at,
    endedAt: e.ended_at
  }));
}

/** What the person can do in Advisory in this company. Throws when they cannot even browse. */
export async function advisoryCan(env: Env, companyId: string, userId: string) {
  await requirePermission(env, companyId, userId, "advisory.browse");
  const [sell, manage] = await Promise.all([
    hasPermission(env, companyId, userId, "advisory.sell"),
    hasPermission(env, companyId, userId, "advisory.manage")
  ]);
  return { browse: true, sell, manage };
}

/** The fee percent of an advisor, for the web app. */
export const feePercent = (a: Pick<AdvisorRow, "fee_bps">) => bpsToPercent(a.fee_bps);

/** The owners and admins who can manage Advisory, for emails. Read-only join on core tables. */
export async function managerEmails(env: Env, companyId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT u.id, u.email FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? AND m.role IN ('owner', 'admin')"
  )
    .bind(companyId)
    .all<{ id: string; email: string }>();
  const out: string[] = [];
  for (const r of rows.results) if (await hasPermission(env, companyId, r.id, "advisory.manage")) out.push(r.email);
  return out;
}
