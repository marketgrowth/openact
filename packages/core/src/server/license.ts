import type { Env } from "./env";
import { LICENSE_PUBLIC_KEYS } from "./license-keys.ts";
import { readSaved } from "./license-store.ts";
import { licenseHostOk, licenseTime, parseLicense, type LicensePayload } from "../shared/plans.ts";

/*
 * License keys for self-hosted deploys.
 *
 * MarketGrowth signs each key with an Ed25519 private key. The core checks the signature with the
 * public keys in license-keys.ts, without a network call. Put the key in the OPENACT_LICENSE secret, or save it in
 * Site settings > Plan. A deploy that buys through the Director store saves its keys there by itself.
 * Make keys with `npm run license -- issue`. See docs/plans.md.
 */

export type LicenseCheck =
  | { ok: true; payload: LicensePayload; inGrace: boolean }
  /** `ended`: the key was valid, with a good signature and host, but its time is over. See fallbackCovers(). */
  | { ok: false; error: string; ended?: LicensePayload };

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
  if (!licenseHostOk(payload, opts.host)) return { ok: false, error: `The license key works only on ${payload.hosts!.join(", ")}.` };
  const time = licenseTime(payload, opts.now);
  if (time === "expired")
    return {
      ok: false,
      error: `The license key for ${payload.licensee} expired on ${payload.expiresAt}. Paid app versions from before that day keep working. Renew the key to get updates.`,
      ended: payload
    };
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

/* Each isolate checks a key once an hour, and logs a problem once. */
const checked = new Map<string, { at: number; result: LicenseCheck }>();
const TTL_MS = 3600_000;

async function checkCached(key: string, host: string | null, label: string): Promise<LicenseCheck> {
  const id = `${host ?? ""}|${key}`;
  const now = Date.now();
  const hit = checked.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.result;
  const result = await checkLicense(key, { host });
  if (!result.ok && !result.ended) console.warn(`[openact] ${label} does not work: ${result.error}`);
  else if (result.ok && result.inGrace) console.warn(`[openact] The license key expired on ${result.payload.expiresAt}. Paid apps stop getting updates soon. Renew the key.`);
  if (checked.size > 20) checked.clear();
  checked.set(id, { at: now, result });
  return result;
}

/** How good a check is: a working key, then an ended key with a later last day, then a broken key. */
const rank = (r: LicenseCheck): [number, string] => (r.ok ? [2, r.payload.expiresAt] : r.ended ? [1, r.ended.expiresAt] : [0, ""]);

/**
 * The deploy's license, or null when it has no key. A key comes from the OPENACT_LICENSE secret, or from
 * Site settings > Plan (saved by hand, or fetched from the Director store). When both are there, the better one wins.
 */
export async function deployLicense(env: Env, requestUrl?: string): Promise<LicenseCheck | null> {
  return (await deployLicenseSource(env, requestUrl))?.result ?? null;
}

/** The deploy's license and where it came from. */
export async function deployLicenseSource(
  env: Env,
  requestUrl?: string
): Promise<{ result: LicenseCheck; source: "secret" | "settings"; key: string } | null> {
  const host = deployHost(env, requestUrl);
  const secret = (env.OPENACT_LICENSE || "").trim();
  const saved = (await readSaved(env)).license?.trim() || "";
  const options: Array<{ result: LicenseCheck; source: "secret" | "settings"; key: string }> = [];
  if (secret) options.push({ result: await checkCached(secret, host, "OPENACT_LICENSE"), source: "secret", key: secret });
  if (saved && saved !== secret) options.push({ result: await checkCached(saved, host, "The saved license key"), source: "settings", key: saved });
  if (!options.length) return null;
  options.sort((a, b) => {
    const [ra, da] = rank(a.result);
    const [rb, db] = rank(b.result);
    return rb - ra || db.localeCompare(da);
  });
  return options[0]!;
}
