import type { Env } from "./env";
import { LICENSE_PUBLIC_KEYS } from "./license-keys.ts";
import { licenseHostOk, licenseTime, parseLicense, type LicensePayload } from "../shared/plans.ts";

/*
 * License keys for self-hosted deploys.
 *
 * MarketGrowth signs each key with an Ed25519 private key. The core checks the signature with the
 * public keys in license-keys.ts, without a network call. Put the key in the OPENACT_LICENSE secret.
 * Make keys with `npm run license -- issue`. See docs/plans.md.
 */

export type LicenseCheck =
  | { ok: true; payload: LicensePayload; inGrace: boolean }
  | { ok: false; error: string };

const fromB64Url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
};

/**
 * Checks a license key: its format, its signature, its dates and its host.
 * `keys` maps a key id to a raw Ed25519 public key in base64url. Tests pass their own keys.
 */
export async function checkLicense(
  key: string,
  opts: { host: string | null; now?: number; keys?: Record<string, string> } = { host: null }
): Promise<LicenseCheck> {
  const parsed = parseLicense(key);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const { payload, signed, signature } = parsed;
  const publicKey = (opts.keys ?? LICENSE_PUBLIC_KEYS)[payload.kid];
  if (!publicKey) return { ok: false, error: `This OpenAct does not know the signing key "${payload.kid}". Update OpenAct, or ask MarketGrowth for a new key.` };
  let valid = false;
  try {
    const k = await crypto.subtle.importKey("raw", fromB64Url(publicKey), { name: "Ed25519" }, false, ["verify"]);
    valid = await crypto.subtle.verify({ name: "Ed25519" }, k, signature, new TextEncoder().encode(signed));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "The license key signature is not valid. Copy the whole key again, or ask MarketGrowth for a new key." };
  const time = licenseTime(payload, opts.now);
  if (time === "expired") return { ok: false, error: `The license key for ${payload.licensee} expired on ${payload.expiresAt}. Renew it to keep the paid apps.` };
  if (!licenseHostOk(payload, opts.host)) return { ok: false, error: `The license key works only on ${payload.hosts!.join(", ")}.` };
  return { ok: true, payload, inGrace: time === "grace" };
}

/** The host name of this deploy, from APP_URL, or null when APP_URL is empty. */
export function deployHost(env: Env, requestUrl?: string): string | null {
  const configured = (env.APP_URL || "").trim();
  try {
    if (configured) return new URL(configured).hostname;
    return requestUrl ? new URL(requestUrl).hostname : null;
  } catch {
    return null;
  }
}

/* Each isolate checks the key once an hour, and logs a problem once. */
let cached: { key: string; host: string | null; at: number; result: LicenseCheck } | null = null;
const TTL_MS = 3600_000;

/** The deploy's license, or null when OPENACT_LICENSE is empty or does not work. */
export async function deployLicense(env: Env, requestUrl?: string): Promise<LicenseCheck | null> {
  const key = (env.OPENACT_LICENSE || "").trim();
  if (!key) return null;
  const host = deployHost(env, requestUrl);
  const now = Date.now();
  if (cached && cached.key === key && cached.host === host && now - cached.at < TTL_MS) return cached.result;
  const result = await checkLicense(key, { host });
  if (!result.ok) console.warn(`[openact] OPENACT_LICENSE does not work: ${result.error}`);
  else if (result.inGrace) console.warn(`[openact] The license key expired on ${result.payload.expiresAt}. Paid apps stop soon. Renew the key.`);
  cached = { key, host, at: now, result };
  return result;
}
