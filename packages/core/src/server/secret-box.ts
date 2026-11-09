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

async function aesKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("openact/company-ai"), info: enc.encode("api-key v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypts an API key for one company. The result is "v1." + base64(iv + ciphertext). */
export async function sealKey(secret: string, companyId: string, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(companyId) }, await aesKey(secret), enc.encode(key)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `v1.${b64(out)}`;
}

/** Decrypts a saved key. Returns null when the secret or the company id do not match. */
export async function openKey(secret: string, companyId: string, sealed: string): Promise<string | null> {
  if (!sealed.startsWith("v1.")) return null;
  try {
    const raw = unb64(sealed.slice(3));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(companyId) }, await aesKey(secret), raw.slice(12));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

