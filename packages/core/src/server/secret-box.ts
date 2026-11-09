/*
 * Encrypts short secrets, such as a company's AI API key, before they go into D1.
 * AES-GCM with a key from HKDF over AUTH_SECRET. The owner id (such as a company id) is bound
 * as additional data, so a secret copied to another row does not decrypt.
 * No imports, so tests can load this file directly.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** Key separation: each purpose gets its own key. The default purpose is the company AI key, as before. */
const DEFAULT_PURPOSE = { salt: "openact/company-ai", info: "api-key v1" };

async function aesKey(secret: string, purpose = DEFAULT_PURPOSE): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(purpose.salt), info: enc.encode(purpose.info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypts an API key for one company. The result is "v1." + base64(iv + ciphertext). */
export async function sealKey(secret: string, companyId: string, key: string, purpose = DEFAULT_PURPOSE): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(companyId) }, await aesKey(secret, purpose), enc.encode(key))
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `v1.${b64(out)}`;
}

/** Decrypts a saved key. Returns null when the secret or the company id do not match. */
export async function openKey(secret: string, companyId: string, sealed: string, purpose = DEFAULT_PURPOSE): Promise<string | null> {
  if (!sealed.startsWith("v1.")) return null;
  try {
    const raw = unb64(sealed.slice(3));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(companyId) },
      await aesKey(secret, purpose),
      raw.slice(12)
    );
    return dec.decode(pt);
  } catch {
    return null;
  }
}


/**
 * Encrypts a short secret for an app, such as a share link token, so the app can show it again later.
 * `purpose` names the use, such as "docs-share". Each purpose gets its own key. `ownerId` is bound to the result,
 * so a value copied to another row does not decrypt. Store a hash next to it for lookups.
 */
export const sealSecret = (secret: string, purpose: string, ownerId: string, value: string) =>
  sealKey(secret, ownerId, value, { salt: `openact/app/${purpose}`, info: "v1" });

/** Decrypts a value from sealSecret(). Returns null when the secret, the purpose or the owner id do not match. */
export const openSecret = (secret: string, purpose: string, ownerId: string, sealed: string) =>
  openKey(secret, ownerId, sealed, { salt: `openact/app/${purpose}`, info: "v1" });
