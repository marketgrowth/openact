import { HttpError } from "@openact/core/server";
import type { AdvisoryEnv } from "./data";

/*
 * Stripe calls for Advisory. They use the brand's platform key, ADVISORY_STRIPE_SECRET_KEY.
 * Plans (OpenAct Director and Producer) use another key, STRIPE_SECRET_KEY, so the two never mix.
 */

/*
 * Accounts v2 needs a pinned API version on every /v2 call.
 * 2026-10-28.endive is the version that stripe-node 23.1 sends.
 */
export const STRIPE_V2_VERSION = "2026-10-28.endive";

type StripeError = { error?: { type?: string; code?: string; message?: string } };

async function send<T>(env: AdvisoryEnv, url: string, init: RequestInit, label: string): Promise<T> {
  const key = (env.ADVISORY_STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new HttpError(400, "Payments are not set up on this site yet. Ask the person who runs it to connect Stripe.", "payments_off");
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new HttpError(502, "Stripe cannot be reached. Try again in a minute.");
  }
  const data = (await res.json().catch(() => null)) as (T & StripeError) | null;
  if (!res.ok || !data) {
    // Log the error type and code only. Never log the key or the body.
    console.warn("[openact] Advisory Stripe request failed", label, res.status, data?.error?.type, data?.error?.code);
    throw new HttpError(502, "Stripe did not answer as expected. Try again, or ask the person who runs this site.");
  }
  return data;
}

/** A call to the v1 API (form encoded). Checkout, subscriptions and Express login links use v1. */
export async function stripe<T>(env: AdvisoryEnv, method: "GET" | "POST", path: string, form?: URLSearchParams): Promise<T> {
  return send<T>(
    env,
    `https://api.stripe.com/v1/${path}`,
    { method, body: form, headers: form ? { "Content-Type": "application/x-www-form-urlencoded" } : {} },
    `v1/${path.split("/")[0]}`
  );
}

/** A call to the v2 API (JSON). Connected accounts and account links use v2. */
export async function stripeV2<T>(env: AdvisoryEnv, method: "GET" | "POST", path: string, body?: unknown, query?: URLSearchParams): Promise<T> {
  const qs = query && [...query.keys()].length ? `?${query}` : "";
  return send<T>(
    env,
    `https://api.stripe.com/v2/${path}${qs}`,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Stripe-Version": STRIPE_V2_VERSION, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }
    },
    `v2/${path.split("/").slice(0, 2).join("/")}`
  );
}

/** The parts of a v2 Account that Advisory reads. */
export interface StripeAccount {
  id: string;
  configuration?: {
    recipient?: {
      capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } };
    } | null;
  } | null;
}

/**
 * True when the connected account can receive its share of a destination charge.
 * Advisory uses destination charges without on_behalf_of, so the account needs only
 * the recipient configuration with an active stripe_balance.stripe_transfers capability.
 */
export const accountReady = (a: StripeAccount) => a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";

export interface StripeCheckoutSession {
  id: string;
  url?: string | null;
  status?: string;
  payment_status?: string;
  mode?: string;
  amount_total?: number | null;
  metadata?: Record<string, string>;
  payment_intent?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
}

export interface StripeSubscriptionLite {
  id: string;
  status: string;
  metadata?: Record<string, string>;
}

export const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : (v?.id ?? null));
