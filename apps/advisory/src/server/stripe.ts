import { HttpError } from "@openact/core/server";
import type { AdvisoryEnv } from "./data";

/*
 * Stripe calls for Advisory. They use the brand's platform key, ADVISORY_STRIPE_SECRET_KEY.
 * Plans (OpenAct Director and Producer) use another key, STRIPE_SECRET_KEY, so the two never mix.
 */

export async function stripe<T>(env: AdvisoryEnv, method: "GET" | "POST", path: string, form?: URLSearchParams): Promise<T> {
  const key = (env.ADVISORY_STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new HttpError(400, "Payments are not set up on this site yet. Ask the person who runs it to connect Stripe.", "payments_off");
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
  const data = (await res.json().catch(() => null)) as (T & { error?: { type?: string; code?: string; message?: string } }) | null;
  if (!res.ok || !data) {
    // Log the error type only. Never log the key or the form.
    console.warn("[openact] Advisory Stripe request failed", path.split("/")[0], res.status, data?.error?.type, data?.error?.code);
    throw new HttpError(502, "Stripe did not answer as expected. Try again, or ask the person who runs this site.");
  }
  return data;
}

export interface StripeAccount {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
}

/** True when a connected account can take payments. */
export const accountReady = (a: StripeAccount) => !!a.charges_enabled && !!a.details_submitted;

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
