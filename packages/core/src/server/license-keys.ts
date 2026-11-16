/*
 * The public keys that sign OpenAct license keys, by key id.
 * Each value is a raw Ed25519 public key in base64url.
 *
 * MarketGrowth keeps the private keys. Make a key pair with `npm run license -- keygen`,
 * then add the public key here with a new key id. Keep old ids while their licenses are still in use.
 * Changing or removing these keys to get paid apps without a license breaks the OpenAct Director License.
 */
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {};
