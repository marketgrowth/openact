import type { Env } from "./env";
import { openSecret, sealSecret } from "./secret-box.ts";

/*
 * The license key and the store claim token that a super admin saved in Site settings > Plan.
 * Both are sealed with AUTH_SECRET in site_settings. The OPENACT_LICENSE secret still works, and the newer key wins.
 * See director.ts and license.ts.
 */

const LICENSE_KEY = "license_key";
const CLAIM_KEY = "store_claim";
const OWNER = "site";

export interface Saved {
  license: string | null;
  claim: string | null;
}

let cached: { at: number; value: Saved } | null = null;
const TTL_MS = 60_000;

/**
 * The secret for sealing. Before APP_URL is set, a local run uses the development secret.
 * auth.ts loads on first use, so modules that only check keys (and their tests) do not load sign-in code.
 */
async function secretOf(env: Env): Promise<string> {
  const { authSecret } = await import("./auth.ts");
  return authSecret(env, env.APP_URL || "http://localhost/");
}

/** The saved license key and claim token. Before migration 0006 runs, there are none. */
export async function readSaved(env: Env, fresh = false): Promise<Saved> {
  const now = Date.now();
  if (!fresh && cached && now - cached.at < TTL_MS) return cached.value;
  const value: Saved = { license: null, claim: null };
  try {
    const rows = await env.DB.prepare("SELECT key, value FROM site_settings WHERE key IN (?, ?)").bind(LICENSE_KEY, CLAIM_KEY).all<{ key: string; value: string }>();
    for (const r of rows.results) {
      if (r.key === LICENSE_KEY) value.license = await openSecret(await secretOf(env), "site-license", OWNER, r.value);
      if (r.key === CLAIM_KEY) value.claim = await openSecret(await secretOf(env), "store-claim", OWNER, r.value);
    }
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  }
  cached = { at: now, value };
  return value;
}

async function put(env: Env, key: string, purpose: string, value: string | null, userId: string | null): Promise<void> {
  if (value === null) await env.DB.prepare("DELETE FROM site_settings WHERE key = ?").bind(key).run();
  else
    await env.DB.prepare(
      "INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
    )
      .bind(key, await sealSecret(await secretOf(env), purpose, OWNER, value), userId, new Date().toISOString())
      .run();
  cached = null;
}

export const saveLicense = (env: Env, license: string | null, userId: string | null) => put(env, LICENSE_KEY, "site-license", license, userId);
export const saveClaim = (env: Env, claim: string | null, userId: string | null) => put(env, CLAIM_KEY, "store-claim", claim, userId);
