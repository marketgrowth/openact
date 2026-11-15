import { Hono, type Context } from "hono";
import {
  HttpError,
  authSecret,
  checkLicense,
  defineServerApp,
  nowIso,
  openSecret,
  isSuperAdmin,
  readJson,
  requireUser,
  sealSecret,
  type AppEnv,
  type Env
} from "@openact/core/server";
import { licenseTime, parseLicense, toB64Url } from "@openact/core/shared";
import {
  cleanKid,
  cleanLicenseInput,
  licensePayload,
  type Inspection,
  type IssuedLicense,
  type LicensesState,
  type Plan,
  type SigningKey,
  type Use
} from "../shared/rules";

/*
 * License Keys, for MarketGrowth only. It runs on the private deploy at on.openact.ing.
 *
 * - Super admins make Ed25519 key pairs here. The Worker makes the pair, seals the private key with AUTH_SECRET
 *   (sealSecret, purpose "licenses-signing", bound to the key id) and stores it in D1. The private key never
 *   leaves this deploy: no route returns it.
 * - Super admins issue license keys with a key pair. The key format matches scripts/license.mjs and the core's checkLicense().
 * - Every route needs a super admin. The data is for the whole site, not for one company, so its rows have no company_id.
 *
 * If AUTH_SECRET changes, the sealed private keys stop working. Licenses already issued keep working.
 * Make a new key pair, release its public key and issue new licenses with it.
 */

const PURPOSE = "licenses-signing";

/** Every route needs a super admin of this deploy. */
function requireSuperAdmin(c: Context<AppEnv>) {
  const user = requireUser(c);
  if (!isSuperAdmin(c.env, user)) throw new HttpError(403, "Only super admins can use License Keys. Ask the person who runs this site.", "not_super_admin");
  return user;
}
const enc = new TextEncoder();

const routes = new Hono<AppEnv>();

interface KeyRow {
  kid: string;
  public_key: string;
  private_box: string;
  created_at: string;
  retired_at: string | null;
  licenses: number;
}

interface LicenseRow {
  id: string;
  kid: string;
  licensee: string;
  plan: string;
  key_use: string;
  hosts: string;
  issued_at: string;
  expires_at: string;
  note: string;
  license: string;
  created_at: string;
}

const releaseLine = (kid: string, publicKey: string) => `"${kid}": "${publicKey}",`;

/**
 * True when this build of OpenAct trusts the license's signing key: the signature passes checkLicense() with the
 * public keys in license-keys.ts. The check runs as of the issue day, so an expired license still counts.
 */
async function trustedByBuild(license: string, issuedAt: string): Promise<boolean> {
  const r = await checkLicense(license, { host: null, now: Date.parse(`${issuedAt}T12:00:00Z`) });
  // A license with hosts fails the host check with host null, but only after the signature passed.
  return r.ok || /works only on/.test(r.error);
}

async function keyRows(env: Env): Promise<KeyRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT k.kid, k.public_key, k.private_box, k.created_at, k.retired_at,
       (SELECT COUNT(*) FROM licenses_keys l WHERE l.kid = k.kid) AS licenses
     FROM licenses_signing_keys k ORDER BY k.created_at DESC`
  ).all<KeyRow>();
  return results;
}

function toLicense(r: LicenseRow): IssuedLicense {
  let hosts: string[] = [];
  try {
    const v = JSON.parse(r.hosts);
    hosts = Array.isArray(v) ? v.filter((h): h is string => typeof h === "string") : [];
  } catch {
    hosts = [];
  }
  return {
    id: r.id,
    kid: r.kid,
    licensee: r.licensee,
    plan: r.plan as Plan,
    use: r.key_use as Use,
    hosts,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    note: r.note,
    license: r.license,
    createdAt: r.created_at,
    time: licenseTime({ expiresAt: r.expires_at })
  };
}

async function state(env: Env): Promise<LicensesState> {
  const [keys, lic] = await Promise.all([
    keyRows(env),
    env.DB.prepare("SELECT * FROM licenses_keys ORDER BY created_at DESC LIMIT 500").all<LicenseRow>()
  ]);
  const licenses = lic.results.map(toLicense);
  const signingKeys: SigningKey[] = await Promise.all(
    keys.map(async (k) => {
      // A probe license signed by this key shows whether this build trusts the key.
      const sample = await probe(env, k).catch(() => null);
      return {
        kid: k.kid,
        publicKey: k.public_key,
        createdAt: k.created_at,
        retiredAt: k.retired_at,
        releaseLine: releaseLine(k.kid, k.public_key),
        released: sample ? await trustedByBuild(sample.license, sample.issuedAt) : false,
        licenses: k.licenses
      };
    })
  );
  return { signingKeys, licenses };
}

async function privateKey(env: Env, c: Context<AppEnv> | null, row: Pick<KeyRow, "kid" | "private_box">): Promise<CryptoKey> {
  const pkcs8 = await openSecret(authSecret(env, c?.req.url ?? ""), PURPOSE, row.kid, row.private_box);
  if (!pkcs8)
    throw new HttpError(
      409,
      `The private key for ${row.kid} does not open. AUTH_SECRET may have changed. Make a new key pair, then release its public key.`,
      "key_locked"
    );
  const bytes = Uint8Array.from(atob(pkcs8), (ch) => ch.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", bytes, { name: "Ed25519" }, false, ["sign"]);
}

async function sign(key: CryptoKey, payload: object): Promise<string> {
  const signed = `oa1.${toB64Url(enc.encode(JSON.stringify(payload)))}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, enc.encode(signed)));
  return `${signed}.${toB64Url(signature)}`;
}

/** A license that is never stored or shown. It only shows whether this build trusts the key. */
async function probe(env: Env, row: Pick<KeyRow, "kid" | "private_box">): Promise<{ license: string; issuedAt: string }> {
  const day = new Date().toISOString().slice(0, 10);
  const license = await sign(await privateKey(env, null, row), {
    id: "probe",
    kid: row.kid,
    licensee: "probe",
    plan: "director",
    issuedAt: day,
    expiresAt: day,
    use: "grants",
    hosts: ["probe.invalid"]
  });
  return { license, issuedAt: day };
}

routes.get("/", async (c) => {
  requireSuperAdmin(c);
  return c.json(await state(c.env));
});

/** Makes a key pair. Body: { kid } */
routes.post("/signing-keys", async (c) => {
  const user = requireSuperAdmin(c);
  const k = cleanKid((await readJson(c)).kid);
  if ("problem" in k) throw new HttpError(400, k.problem);
  const exists = await c.env.DB.prepare("SELECT kid FROM licenses_signing_keys WHERE kid = ?").bind(k.kid).first();
  if (exists) throw new HttpError(409, `The key id ${k.kid} is taken. Choose another id, such as ${k.kid}-2.`);
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const box = await sealSecret(authSecret(c.env, c.req.url), PURPOSE, k.kid, btoa(String.fromCharCode(...pkcs8)));
  await c.env.DB.prepare("INSERT INTO licenses_signing_keys (kid, public_key, private_box, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(k.kid, toB64Url(raw), box, user.id, nowIso())
    .run();
  return c.json(await state(c.env), 201);
});

/** Retires a key pair: it signs no new licenses. Licenses it signed keep working. */
routes.post("/signing-keys/:kid/retire", async (c) => {
  requireSuperAdmin(c);
  const r = await c.env.DB.prepare("UPDATE licenses_signing_keys SET retired_at = ? WHERE kid = ? AND retired_at IS NULL")
    .bind(nowIso(), c.req.param("kid"))
    .run();
  if (!r.meta.changes) throw new HttpError(404, "This key does not exist, or it is already retired.");
  return c.json(await state(c.env));
});

/** Issues a license key. Body: { kid, licensee, plan, use, expiresAt, hosts, note } */
routes.post("/licenses", async (c) => {
  const user = requireSuperAdmin(c);
  const input = cleanLicenseInput(await readJson(c));
  if ("problem" in input) throw new HttpError(400, input.problem);
  const row = await c.env.DB.prepare("SELECT kid, public_key, private_box, retired_at FROM licenses_signing_keys WHERE kid = ?")
    .bind(input.kid)
    .first<{ kid: string; public_key: string; private_box: string; retired_at: string | null }>();
  if (!row) throw new HttpError(404, `There is no key pair ${input.kid}. Make one first.`);
  if (row.retired_at) throw new HttpError(409, `The key ${input.kid} is retired. Choose another key.`);
  const id = `lic_${input.issuedAt.replace(/-/g, "")}_${toB64Url(crypto.getRandomValues(new Uint8Array(6)))}`;
  const license = await sign(await privateKey(c.env, c, row), licensePayload(id, input));
  // Check the new key the same way a deploy does, with this key pair's public key.
  const check = await checkLicense(license, { host: input.hosts[0] ?? null, keys: { [row.kid]: row.public_key } });
  if (!check.ok) throw new HttpError(500, `The new license did not pass the check: ${check.error}`);
  await c.env.DB.prepare(
    `INSERT INTO licenses_keys (id, kid, licensee, plan, key_use, hosts, issued_at, expires_at, note, license, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, row.kid, input.licensee, input.plan, input.use, JSON.stringify(input.hosts), input.issuedAt, input.expiresAt, input.note, license, user.id, nowIso())
    .run();
  return c.json(await state(c.env), 201);
});

/** Reads any license key and checks it. Body: { license } */
routes.post("/inspect", async (c) => {
  requireSuperAdmin(c);
  const raw = (await readJson(c)).license;
  if (typeof raw !== "string" || !raw.trim()) throw new HttpError(400, "Paste a license key. It starts with oa1.");
  const parsed = parseLicense(raw.trim());
  if ("error" in parsed) throw new HttpError(400, parsed.error);
  const { payload } = parsed;
  const row = await c.env.DB.prepare("SELECT public_key FROM licenses_signing_keys WHERE kid = ?").bind(payload.kid).first<{ public_key: string }>();
  const here = row ? await checkLicense(raw.trim(), { host: null, now: Date.parse(`${payload.issuedAt}T12:00:00Z`), keys: { [payload.kid]: row.public_key } }) : null;
  const signedHere = here ? here.ok || /works only on/.test(here.error) : null;
  const trusted = await trustedByBuild(raw.trim(), payload.issuedAt);
  const out: Inspection = {
    payload: payload as unknown as Record<string, unknown>,
    signedHere,
    trusted,
    time: licenseTime(payload),
    problem: signedHere === false ? "The signature does not match the key pair with this id. Someone changed the key." : null
  };
  return c.json(out);
});

export default defineServerApp({
  id: "licenses",
  name: "License Keys",
  routes: (api) => api.route("/api/apps/licenses", routes)
});
