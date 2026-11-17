import {
  CONTRIBUTE_API,
  X402_NETWORKS,
  decodeHeader,
  encodeHeader,
  formatUsd,
  isAddress,
  isStripeTestKey,
  parseUsd,
  paymentProblem,
  paymentRequirements,
  stripePortalUrl,
  type ContributeOptions,
  type Frequency,
  type PaymentRequired,
  type X402Network
} from "../../src/shared/contribute.ts";

/*
 * Contributions on https://openact.ing/contribute. The page is public/contribute.html with public/contribute.js.
 * People pay by card (Stripe Checkout) or in USDC (x402 v2). AI agents can pay the x402 endpoint.
 * Routes: GET /api/contribute, POST /api/contribute/checkout, GET or POST /api/contribute/x402?amount=5.
 */

/** Settings for contributions, as secrets on the openact-site Worker. All are optional. A payment method shows only when it is set up. */
export interface ContributeEnv {
  /** Secret. A Stripe secret key or a restricted key that can write Checkout Sessions. */
  STRIPE_SECRET_KEY?: string;
  /** Optional. A connected account id (acct_...). Checkout then runs on that account, so funds go straight to it. */
  STRIPE_ACCOUNT?: string;
  /** Optional. The Stripe customer portal login link (https://billing.stripe.com/p/login/...). */
  STRIPE_PORTAL_URL?: string;
  /** The wallet that receives USDC. */
  X402_PAY_TO?: string;
  /** CAIP-2 network: eip155:8453 (Base) or eip155:84532 (Base Sepolia). Default: Base Sepolia. */
  X402_NETWORK?: string;
  /** The x402 facilitator. Default: https://x402.org/facilitator (test networks only). */
  X402_FACILITATOR_URL?: string;
  /** Secret. Optional bearer token for the facilitator. */
  X402_FACILITATOR_TOKEN?: string;
}

const X402_PATH = `${CONTRIBUTE_API}/x402`;
const DEFAULT_FACILITATOR = "https://x402.org/facilitator";

/** An error with a plain message that the page can show. */
class Problem extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers }
  });

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
  if ("error" in r) throw new Problem(400, r.error);
  return r.cents;
}

/** The payment options that are set up. The page shows only these. */
export function contributeOptions(env: ContributeEnv, origin: string): ContributeOptions {
  const setup = cryptoSetup(env);
  const key = (env.STRIPE_SECRET_KEY || "").trim();
  return {
    card: !!key,
    cardTestMode: isStripeTestKey(key),
    manageUrl: key ? stripePortalUrl(env.STRIPE_PORTAL_URL) : "",
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
          rpcUrl: setup.net.rpcUrl,
          explorer: setup.net.explorer,
          endpoint: `${origin}${X402_PATH}`
        }
      : null
  };
}

/* Stripe Checkout, through the REST API. No SDK. */

async function startCheckout(env: ContributeEnv, origin: string, cents: number, frequency: Frequency): Promise<string> {
  const key = (env.STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new Problem(404, "Card contributions are not set up yet. Pay with USDC, or try again later.");
  const monthly = frequency === "monthly";
  const form = new URLSearchParams({
    mode: monthly ? "subscription" : "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][price_data][product_data][name]": `${monthly ? "Monthly contribution" : "Contribution"} to OpenAct`,
    "line_items[0][price_data][product_data][description]": "Helps build OpenAct, the open source framework for agentic business apps.",
    success_url: `${origin}/contribute?thanks=card`,
    cancel_url: `${origin}/contribute`,
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
    throw new Problem(502, "Stripe cannot be reached. Try again in a minute.");
  }
  const data = (await res.json().catch(() => null)) as { url?: string; error?: { type?: string; code?: string } } | null;
  if (!res.ok || !data?.url) {
    // Log the error type only. Never log the key.
    console.warn("[openact] Stripe Checkout failed", res.status, data?.error?.type, data?.error?.code);
    throw new Problem(502, "Stripe did not start the checkout. Try again, or pay with USDC.");
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

async function x402(request: Request, env: ContributeEnv, origin: string): Promise<Response> {
  const setup = cryptoSetup(env);
  if (!setup) throw new Problem(404, "USDC contributions are not set up yet. Pay by card, or try again later.");
  const cents = readAmount(new URL(request.url).searchParams.get("amount"));
  const req = paymentRequirements(setup.net, setup.payTo, cents);
  const resourceUrl = `${origin}${X402_PATH}?amount=${(cents / 100).toFixed(2)}`;

  const required = (error: string) => {
    const body: PaymentRequired = {
      x402Version: 2,
      error,
      resource: { url: resourceUrl, description: `A ${formatUsd(cents)} contribution to help build OpenAct.`, mimeType: "application/json" },
      accepts: [req]
    };
    return json(body, 402, { "PAYMENT-REQUIRED": encodeHeader(body) });
  };

  const header = request.headers.get("payment-signature");
  if (!header) return required("Payment required");

  const payment = decodeHeader(header);
  const problem = paymentProblem(payment, req);
  if (problem) return required(problem);

  const ask = { x402Version: 2, paymentPayload: payment, paymentRequirements: req };
  const verified = await facilitator<{ isValid?: boolean; invalidReason?: string | null }>(env, "verify", ask);
  if (!verified) return json({ error: "The payment service cannot be reached. Your wallet was not charged. Try again." }, 502);
  if (!verified.isValid) return required(verified.invalidReason || "The payment is not valid.");

  const settled = await facilitator<{ success?: boolean; errorReason?: string | null; transaction?: string; network?: string; payer?: string }>(env, "settle", ask);
  if (!settled) return json({ error: "The payment service cannot be reached. Check your wallet before you try again." }, 502);
  if (!settled.success || !settled.transaction) return required(settled.errorReason || "The payment did not settle.");

  return json(
    {
      ok: true,
      message: `Thank you for your ${formatUsd(cents)} contribution. It helps build OpenAct.`,
      amount: formatUsd(cents),
      network: settled.network || req.network,
      payer: settled.payer,
      transaction: settled.transaction,
      receipt: `${setup.net.explorer}/tx/${settled.transaction}`
    },
    200,
    { "PAYMENT-RESPONSE": encodeHeader(settled) }
  );
}

/** True for a page on this computer, such as wrangler dev. wrangler dev gives the Worker the openact.ing address, not localhost. */
const isLocal = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

/** True for a request to the contribution routes. */
export const isContributeRoute = (pathname: string) => pathname === CONTRIBUTE_API || pathname.startsWith(`${CONTRIBUTE_API}/`);

/** Answers the contribution routes. Every answer is JSON. */
export async function handleContribute(request: Request, env: ContributeEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  try {
    if (url.pathname === CONTRIBUTE_API && request.method === "GET") return json(contributeOptions(env, origin));

    if (url.pathname === `${CONTRIBUTE_API}/checkout` && request.method === "POST") {
      // Only the Contribute page starts a checkout. A browser always sends Origin on a POST.
      const from = request.headers.get("origin");
      if (from && from !== origin && !isLocal(from)) throw new Problem(403, "Start the checkout from the Contribute page.");
      const body = (await request.json().catch(() => null)) as { amount?: unknown; frequency?: unknown } | null;
      if (!body || typeof body !== "object") throw new Problem(400, "Send the amount as JSON.");
      const cents = readAmount(body.amount);
      const frequency = body.frequency === undefined ? "once" : body.frequency;
      if (frequency !== "once" && frequency !== "monthly") throw new Problem(400, "Frequency must be once or monthly.");
      return json({ url: await startCheckout(env, origin, cents, frequency) });
    }

    if (url.pathname === X402_PATH && (request.method === "GET" || request.method === "POST")) return await x402(request, env, origin);

    return json({ error: "This contribution route does not exist. Read https://docs.openact.app/contribute." }, 404);
  } catch (e) {
    if (e instanceof Problem) return json({ error: e.message }, e.status);
    console.warn("[openact] Contribution route failed", e instanceof Error ? e.name : "error");
    return json({ error: "Something went wrong. Try again in a minute." }, 500);
  }
}
