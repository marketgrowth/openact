import { CURRENCIES, type AdvisorySettings, type ApprovalMode, type Currency, type EngagementStatus, type Money, type OfferKind, type Terms } from "./types.ts";

/*
 * Advisory rules. Pure module, used by the Worker, the web app and tests.
 */

export const ADVISORY_HOME = "/a/advisory";

export const DEFAULT_SETTINGS: AdvisorySettings = {
  label: "Advisor",
  labelPlural: "Advisors",
  approvalMode: "required",
  defaultFeePercent: 15,
  currency: "usd"
};

export const LIMITS = {
  label: 30,
  headline: 80,
  bio: 2000,
  offerName: 80,
  offerDescription: 600,
  message: 2000,
  note: 500,
  offersPerAdvisor: 12,
  /** In cents: the smallest price Stripe takes in most currencies is under this. */
  priceMin: 100,
  /** In cents: 100,000.00 in the company's currency. */
  priceMax: 10_000_000,
  /** The highest brand fee, as a percent. */
  feeMax: 50,
  photoBytes: 2 * 1024 * 1024
} as const;

/** Basis points: 1% is 100 bps. Fees are stored as whole bps so math stays exact. */
export const percentToBps = (percent: number) => Math.round(percent * 100);
export const bpsToPercent = (bps: number) => Math.round(bps) / 100;

/** A problem with a fee percent, or null when it is fine. */
export function feeProblem(percent: unknown): string | null {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "The fee must be a number, such as 15.";
  if (percent < 0 || percent > LIMITS.feeMax) return `The fee must be from 0 to ${LIMITS.feeMax} percent.`;
  if (Math.abs(percentToBps(percent) - percent * 100) > 1e-6) return "Use at most two decimal places for the fee.";
  return null;
}

/** The brand fee on one payment, in the smallest unit. Rounds to the nearest unit. */
export function applicationFee(amount: number, feeBps: number): number {
  if (amount <= 0 || feeBps <= 0) return 0;
  return Math.min(amount, Math.round((amount * feeBps) / 10000));
}

/** A problem with a price in the smallest unit, or null when it is fine. */
export function priceProblem(amount: unknown): string | null {
  if (typeof amount !== "number" || !Number.isInteger(amount)) return "The price must be a whole number of cents.";
  if (amount < LIMITS.priceMin) return "The price must be at least 1.00.";
  if (amount > LIMITS.priceMax) return "The price is too high. Use 100,000 or less.";
  return null;
}

export const isCurrency = (v: unknown): v is Currency => (CURRENCIES as readonly unknown[]).includes(v);

/** Formats money like "$1,200" or "$1,200.50". */
export function formatMoney(m: Money): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: m.currency.toUpperCase(),
      minimumFractionDigits: m.amount % 100 ? 2 : 0,
      maximumFractionDigits: 2
    }).format(m.amount / 100);
  } catch {
    return `${(m.amount / 100).toFixed(2)} ${m.currency.toUpperCase()}`;
  }
}

/** Formats a price with its kind, like "$500" or "$2,000 a month". */
export const formatPrice = (m: Money, kind: OfferKind) => (kind === "retainer" ? `${formatMoney(m)} a month` : formatMoney(m));

/** Cleans a label, such as "Consultant". Falls back to the default. */
export function cleanLabel(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.replace(/\s+/g, " ").trim().slice(0, LIMITS.label);
  return s || fallback;
}

/** Reads the settings row. Missing values use the defaults. */
export function readSettings(row: { label?: string | null; label_plural?: string | null; approval_mode?: string | null; default_fee_bps?: number | null; currency?: string | null } | null): AdvisorySettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  const approvalMode: ApprovalMode = row.approval_mode === "auto" ? "auto" : "required";
  return {
    label: cleanLabel(row.label, DEFAULT_SETTINGS.label),
    labelPlural: cleanLabel(row.label_plural, DEFAULT_SETTINGS.labelPlural),
    approvalMode,
    defaultFeePercent: typeof row.default_fee_bps === "number" ? bpsToPercent(row.default_fee_bps) : DEFAULT_SETTINGS.defaultFeePercent,
    currency: isCurrency(row.currency) ? row.currency : DEFAULT_SETTINGS.currency
  };
}

/** The name of an engagement project, such as "Acme Inc: Growth retainer". */
export function engagementProjectName(clientName: string, offerName: string): string {
  const client = clientName.replace(/\s+/g, " ").trim() || "Client";
  const offer = offerName.replace(/\s+/g, " ").trim() || "Engagement";
  const full = `${client}: ${offer}`;
  return full.length <= 80 ? full : `${full.slice(0, 79).trimEnd()}…`;
}

/**
 * The engagement status for a Stripe subscription status.
 * past_due stays active while Stripe tries the card again.
 */
export function engagementStatusFor(subscriptionStatus: string): EngagementStatus {
  return ["active", "trialing", "past_due"].includes(subscriptionStatus) ? "active" : "ended";
}

/** Metadata that marks a Stripe object as an Advisory payment. */
export const STRIPE_SOURCE = "openact-advisory";

export interface CheckoutInput {
  requestId: string;
  companyId: string;
  advisorId: string;
  terms: Terms;
  feeBps: number;
  /** The advisor's connected Stripe account, acct_... */
  destination: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** The host name of this site, for the metadata. */
  site: string;
}

/**
 * The form for POST /v1/checkout/sessions. A destination charge: the client pays the brand's platform account,
 * Stripe moves the money to the advisor's connected account, and the brand keeps the application fee.
 * One-time offers use payment mode. Retainers use subscription mode with a monthly price.
 */
export function checkoutForm(i: CheckoutInput): URLSearchParams {
  const meta = { source: STRIPE_SOURCE, request_id: i.requestId, company_id: i.companyId, advisor_id: i.advisorId, site: i.site };
  const f = new URLSearchParams({
    mode: i.terms.kind === "retainer" ? "subscription" : "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": i.terms.price.currency,
    "line_items[0][price_data][unit_amount]": String(i.terms.price.amount),
    "line_items[0][price_data][product_data][name]": i.terms.name.slice(0, 250),
    client_reference_id: i.requestId,
    customer_email: i.customerEmail,
    success_url: i.successUrl,
    cancel_url: i.cancelUrl
  });
  for (const [k, v] of Object.entries(meta)) f.set(`metadata[${k}]`, v);
  if (i.terms.kind === "retainer") {
    f.set("line_items[0][price_data][recurring][interval]", "month");
    f.set("subscription_data[transfer_data][destination]", i.destination);
    if (i.feeBps > 0) f.set("subscription_data[application_fee_percent]", String(bpsToPercent(i.feeBps)));
    for (const [k, v] of Object.entries(meta)) f.set(`subscription_data[metadata][${k}]`, v);
  } else {
    f.set("payment_intent_data[transfer_data][destination]", i.destination);
    const fee = applicationFee(i.terms.price.amount, i.feeBps);
    if (fee > 0) f.set("payment_intent_data[application_fee_amount]", String(fee));
    for (const [k, v] of Object.entries(meta)) f.set(`payment_intent_data[metadata][${k}]`, v);
  }
  return f;
}

/** The image type of a profile photo from its first bytes, or null when it is not PNG, JPEG or WebP. */
export function sniffPhoto(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp";
  return null;
}

/** Turns a price typed by a person, such as "1,200.50", into cents. Returns null when it is not a price. */
export function parsePriceInput(s: string): number | null {
  const t = s.replace(/[\s,$€£₱]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
