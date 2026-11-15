/*
 * The public keys that sign OpenAct license keys, by key id.
 * Each value is a raw Ed25519 public key in base64url.
 *
 * MarketGrowth keeps the private keys. Make a key pair with `npm run license -- keygen`,
 * then add the public key here with a new key id. Keep old ids while their licenses are still in use.
 * Changing or removing these keys to get paid apps without a license breaks the OpenAct Director License.
 */
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {
  // Demo branch only. Signs the one license for the public demo app at a.openact.ing (host-locked, ends 2027-11-14).
  // Its private key was destroyed after that license was issued, so no other key can use this id.
  "demo-a-openact-ing": "NZA-P4imzgrGt12VC-eY_RAxL09rV4DrwnoUzmAY57g"
};
