import { HttpError, appUrl, defineServerApp, oneOf, readJson, type AppEnv, type Env } from "@openact/core/server";
import type { Context } from "hono";
import {
  X402_NETWORKS,
  decodeHeader,
  encodeHeader,
  formatUsd,
  isAddress,
  parseUsd,
  paymentProblem,
  paymentRequirements,
  type ContributeOptions,
  type PaymentRequired,
  type X402Network
} from "../shared/contribute.ts";

/*
 * This deploy's own server routes, outside any app: contributions.
 * The web side is in src/client/site.tsx. Routes start with /api/apps/site/.
 */

/** Settings for contributions. All are optional. A payment method shows only when it is set up. */
interface ContributeEnv extends Env {
  /** Secret. A Stripe secret key or a restricted key that can write Checkout Sessions. */
  STRIPE_SECRET_KEY?: string;
  /** Optional. A connected account id (acct_...). Checkout then runs on that account, so funds go straight to it. */
  STRIPE_ACCOUNT?: string;
  /** The wallet that receives USDC. */
  X402_PAY_TO?: string;
  /** CAIP-2 network: eip155:8453 (Base) or eip155:84532 (Base Sepolia). Default: Base Sepolia. */
  X402_NETWORK?: string;
  /** The x402 facilitator. Default: https://x402.org/facilitator (test networks only). */
  X402_FACILITATOR_URL?: string;
  /** Secret. Optional bearer token for the facilitator. */
  X402_FACILITATOR_TOKEN?: string;
}

const BASE = "/api/apps/site/contribute";
const X402_PATH = `${BASE}/x402`;
const DEFAULT_FACILITATOR = "https://x402.org/facilitator";

const envOf = (c: Context<AppEnv>) => c.env as ContributeEnv;

function cryptoSetup(env: ContributeEnv): { net: X402Network; payTo: string } | null {
  const payTo = (env.X402_PAY_TO || "").trim();
  if (!payTo) return null;
  if (!isAddress(payTo)) {
    console.warn("[openact] X402_PAY_TO is not a wallet address. USDC contributions are off.");
    return null;
  }
  const net = X402_NETWORKS[(env.X402_NETWORK || "eip155:84532").trim()];
  if (!net) {
    console.warn("[openact] X402_NETWORK must be eip155:8453 or eip155:84532. USDC contributions are off.");
    return null;
  }
  return { net, payTo };
}

function readAmount(raw: unknown): number {
  const r = parseUsd(raw);
  if ("error" in r) throw new HttpError(400, r.error);
  return r.cents;
}

/* Stripe Checkout, through the REST API. No SDK. */

async function startCheckout(c: Context<AppEnv>, cents: number, frequency: "once" | "monthly"): Promise<string> {
  const env = envOf(c);
  const key = (env.STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new HttpError(404, "Card contributions are not set up on this site.");
  const base = appUrl(c);
  const monthly = frequency === "monthly";
  const form = new URLSearchParams({
    mode: monthly ? "subscription" : "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][price_data][product_data][name]": `${monthly ? "Monthly contribution" : "Contribution"} to OpenAct`,
    "line_items[0][price_data][product_data][description]": "Helps build OpenAct, the open source framework for agentic business apps.",
    success_url: `${base}/contribute?thanks=card`,
    cancel_url: `${base}/contribute`,
    "metadata[source]": "openact-contribute",
    "metadata[frequency]": frequency
  });
  if (monthly) {
    form.set("line_items[0][price_data][recurring][interval]", "month");
    form.set("subscription_data[metadata][source]", "openact-contribute");
  } else {
    form.set("submit_type", "pay");
    form.set("payment_intent_data[metadata][source]", "openact-contribute");
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  const account = (env.STRIPE_ACCOUNT || "").trim();
  if (account) headers["Stripe-Account"] = account;

  let res: Response;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers, body: form, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, "Stripe cannot be reached. Try again in a minute.");
  }
  const data = (await res.json().catch(() => null)) as { url?: string; error?: { type?: string; code?: string } } | null;
  if (!res.ok || !data?.url) {
    // Log the error type only. Never log the key.
    console.warn("[openact] Stripe Checkout failed", res.status, data?.error?.type, data?.error?.code);
    throw new HttpError(502, "Stripe did not start the checkout. Try again, or pay with USDC.");
  }
  return data.url;
}

/* x402 v2 */

async function facilitator<T>(env: ContributeEnv, step: "verify" | "settle", body: unknown): Promise<T | null> {
  const url = `${(env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR).trim().replace(/\/+$/, "")}/${step}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = (env.X402_FACILITATOR_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) console.warn(`[openact] x402 ${step} returned`, res.status);
    return data;
  } catch {
    console.warn(`[openact] x402 ${step}: the facilitator cannot be reached`);
    return null;
  }
}

async function x402(c: Context<AppEnv>) {
  const env = envOf(c);
  const setup = cryptoSetup(env);
  if (!setup) throw new HttpError(404, "USDC contributions are not set up on this site.");
  const cents = readAmount(c.req.query("amount"));
  const req = paymentRequirements(setup.net, setup.payTo, cents);
  const resourceUrl = `${appUrl(c)}${X402_PATH}?amount=${(cents / 100).toFixed(2)}`;

  const required = (error: string) => {
    const body: PaymentRequired = {
      x402Version: 2,
      error,
      resource: { url: resourceUrl, description: `A ${formatUsd(cents)} contribution to help build OpenAct.`, mimeType: "application/json" },
      accepts: [req]
    };
    c.header("PAYMENT-REQUIRED", encodeHeader(body));
    return c.json(body, 402);
  };

  const header = c.req.header("payment-signature");
  if (!header) return required("Payment required");

  const payment = decodeHeader(header);
  const problem = paymentProblem(payment, req);
  if (problem) return required(problem);

  const ask = { x402Version: 2, paymentPayload: payment, paymentRequirements: req };
  const verified = await facilitator<{ isValid?: boolean; invalidReason?: string | null }>(env, "verify", ask);
  if (!verified) return c.json({ error: "The payment service cannot be reached. Your wallet was not charged. Try again." }, 502);
  if (!verified.isValid) return required(verified.invalidReason || "The payment is not valid.");

  const settled = await facilitator<{ success?: boolean; errorReason?: string | null; transaction?: string; network?: string; payer?: string }>(env, "settle", ask);
  if (!settled) return c.json({ error: "The payment service cannot be reached. Check your wallet before you try again." }, 502);
  if (!settled.success || !settled.transaction) return required(settled.errorReason || "The payment did not settle.");

  c.header("PAYMENT-RESPONSE", encodeHeader(settled));
  return c.json({
    ok: true,
    message: `Thank you for your ${formatUsd(cents)} contribution. It helps build OpenAct.`,
    amount: formatUsd(cents),
    network: settled.network || req.network,
    payer: settled.payer,
    transaction: settled.transaction,
    receipt: `${setup.net.explorer}/tx/${settled.transaction}`
  });
}

export const siteServer = defineServerApp({
  id: "site",
  name: "OpenAct",
  routes(api) {
    api.get(BASE, (c) => {
      const env = envOf(c);
      const setup = cryptoSetup(env);
      const options: ContributeOptions = {
        card: !!(env.STRIPE_SECRET_KEY || "").trim(),
        crypto: setup
          ? {
              network: setup.net.id,
              networkName: setup.net.name,
              testnet: setup.net.testnet,
              chainId: setup.net.chainId,
              asset: setup.net.asset,
              assetName: setup.net.assetName,
              assetVersion: setup.net.assetVersion,
              payTo: setup.payTo,
              endpoint: `${appUrl(c)}${X402_PATH}`
            }
          : null
      };
      return c.json(options);
    });

    api.post(`${BASE}/checkout`, async (c) => {
      const body = await readJson(c);
      const cents = readAmount(body.amount);
      const frequency = body.frequency === undefined ? "once" : oneOf(body.frequency, "frequency", ["once", "monthly"] as const);
      return c.json({ url: await startCheckout(c, cents, frequency) });
    });

    // x402 clients, such as AI agents, may use GET or POST.
    api.get(X402_PATH, x402);
    api.post(X402_PATH, x402);
  }
});
