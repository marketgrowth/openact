/*
 * Contributions: rules shared by the Worker and the web app.
 *
 * People pay by card through Stripe Checkout, or in USDC through x402 v2.
 * Contributions help build OpenAct.
 */

export interface SupportedProject {
  name: string;
  url?: string;
  description: string;
}

/** Nonprofits, and projects that support nonprofits, that OpenAct helps build software for. */
export const SUPPORTED_PROJECTS: SupportedProject[] = [
  {
    name: "Lyra Music Foundation",
    description:
      "A nonprofit. It uses OpenAct to build agentic software that teaches music and theater to young adults around the world. The Hack Foundation is its fiscal sponsor."
  },
  {
    name: "Mission:Told",
    url: "https://missiontold.com",
    description: "A digital media publication. It tells the stories of mission-focused leaders, volunteers and impact builders."
  }
];

/** The smallest and the largest contribution, in US dollars. */
export const MIN_USD = 1;
export const MAX_USD = 10000;

/** Preset amounts on the page, in US dollars. */
export const PRESETS_USD = [10, 25, 50, 100] as const;

export type Frequency = "once" | "monthly";

/** What the page needs to know. The Worker sends it from GET /api/apps/site/contribute. */
export interface ContributeOptions {
  /** True when Stripe Checkout is set up. */
  card: boolean;
  /** Set when x402 payments are set up. */
  crypto: null | {
    network: string;
    networkName: string;
    testnet: boolean;
    chainId: number;
    asset: string;
    assetName: string;
    assetVersion: string;
    payTo: string;
    /** The x402 resource. Agents and the page pay here. */
    endpoint: string;
  };
}

/**
 * Reads an amount in US dollars, such as "25" or "12.50".
 * Returns the amount in cents, or an error message for the person.
 */
export function parseUsd(input: unknown): { cents: number } | { error: string } {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim().replace(/^\$/, "") : "";
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return { error: `Enter an amount in US dollars, from $${MIN_USD} to $${MAX_USD.toLocaleString("en-US")}.` };
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (cents < MIN_USD * 100) return { error: `The smallest contribution is $${MIN_USD}.` };
  if (cents > MAX_USD * 100) return { error: `The largest contribution is $${MAX_USD.toLocaleString("en-US")}. Contact us for a larger gift.` };
  return { cents };
}

/** Formats cents as dollars, such as "$25" or "$12.50". */
export function formatUsd(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* x402 v2 */

export interface X402Network {
  /** CAIP-2 id. */
  id: string;
  name: string;
  chainId: number;
  testnet: boolean;
  /** USDC on this network. */
  asset: string;
  /** The EIP-712 domain name and version of the USDC contract. */
  assetName: string;
  assetVersion: string;
  rpcUrl: string;
  explorer: string;
}

/** The networks OpenAct accepts. USDC uses 6 decimals on both. */
export const X402_NETWORKS: Record<string, X402Network> = {
  "eip155:8453": {
    id: "eip155:8453",
    name: "Base",
    chainId: 8453,
    testnet: false,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetName: "USD Coin",
    assetVersion: "2",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org"
  },
  "eip155:84532": {
    id: "eip155:84532",
    name: "Base Sepolia (test network)",
    chainId: 84532,
    testnet: true,
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    assetName: "USDC",
    assetVersion: "2",
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org"
  }
};

export const X402_TIMEOUT_SECONDS = 300;

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** In base units. USDC has 6 decimals, so 1 cent is "10000". */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { assetTransferMethod: "eip-3009"; name: string; version: string };
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
}

export interface PaymentPayload {
  x402Version: number;
  accepted: PaymentRequirements;
  payload: {
    signature: string;
    authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
  };
}

/** Cents to USDC base units (6 decimals). */
export const centsToUsdcUnits = (cents: number): string => String(BigInt(cents) * 10000n);

export function isAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

export function paymentRequirements(net: X402Network, payTo: string, cents: number): PaymentRequirements {
  return {
    scheme: "exact",
    network: net.id,
    amount: centsToUsdcUnits(cents),
    asset: net.asset,
    payTo,
    maxTimeoutSeconds: X402_TIMEOUT_SECONDS,
    extra: { assetTransferMethod: "eip-3009", name: net.assetName, version: net.assetVersion }
  };
}

const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Checks that a payment matches the terms this server offers, before it goes to the facilitator.
 * The facilitator checks the signature and the balance. This check stops a payment for other terms.
 * Returns null when the payment matches, or a reason.
 */
export function paymentProblem(p: unknown, req: PaymentRequirements): string | null {
  if (!p || typeof p !== "object") return "The payment is not a JSON object.";
  const pay = p as Partial<PaymentPayload>;
  if (pay.x402Version !== 2) return "Use x402 version 2.";
  const a = pay.accepted;
  if (!a || typeof a !== "object") return "The payment has no accepted terms.";
  if (a.scheme !== req.scheme || a.network !== req.network || a.amount !== req.amount || !same(a.asset, req.asset) || !same(a.payTo, req.payTo))
    return "The payment terms do not match the terms this server offers.";
  const auth = pay.payload?.authorization;
  if (!auth || typeof pay.payload?.signature !== "string") return "The payment has no signed authorization.";
  if (!same(auth.to, req.payTo)) return "The payment goes to the wrong address.";
  if (auth.value !== req.amount) return "The payment amount does not match.";
  if (!isAddress(auth.from)) return "The payer address is not valid.";
  return null;
}

/** The EIP-712 typed data for a USDC TransferWithAuthorization (EIP-3009). The web app signs it with the person's wallet. */
export function transferTypedData(net: X402Network, auth: PaymentPayload["payload"]["authorization"]) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    domain: { name: net.assetName, version: net.assetVersion, chainId: net.chainId, verifyingContract: net.asset },
    message: auth
  };
}

/** Base64 of a UTF-8 JSON value, for the x402 headers. Works in the Worker and the browser. */
export function encodeHeader(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeHeader(value: string): unknown {
  try {
    const bin = atob(value.trim());
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
