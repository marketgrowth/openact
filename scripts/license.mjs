#!/usr/bin/env node
/*
 * OpenAct license keys, for MarketGrowth.
 *
 *   npm run license -- keygen [--kid mg-2026] [--out ~/.openact/license-mg-2026.pem]
 *       Makes an Ed25519 key pair. Writes the private key to --out, outside this repository.
 *       Prints the public key. Add it to packages/core/src/server/license-keys.ts under its key id.
 *
 *   npm run license -- issue --key <private.pem> --kid mg-2026 --licensee "Acme Inc." --plan director --expires 2027-11-10
 *       [--id lic_0001] [--issued 2026-11-10] [--hosts app.acme.com,openact.acme.com]
 *       Prints a license key. The customer puts it in the OPENACT_LICENSE secret of their deploy.
 *
 *   npm run license -- inspect <license key>
 *       Prints what a key says. It does not check the signature.
 *
 * Keep private keys out of git, chat and shared drives. Anyone with a private key can make licenses.
 */
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PLANS = ["director", "producer"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (msg) => {
  console.error(`license: ${msg}`);
  process.exit(1);
};

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) fail(`${a} needs a value.`);
      out[a.slice(2)] = v;
      i++;
    } else out._.push(a);
  }
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const expandHome = (p) => (p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p));

function keygen(f) {
  const kid = f.kid ?? `mg-${new Date().getUTCFullYear()}`;
  if (!/^[a-z0-9-]{2,40}$/.test(kid)) fail("--kid must be 2 to 40 lowercase letters, numbers or dashes.");
  const out = expandHome(f.out ?? `~/.openact/license-${kid}.pem`);
  if (!relative(ROOT, out).startsWith("..")) fail("Write the private key outside this repository, so it never goes into git.");
  if (existsSync(out)) fail(`${out} already exists. Choose another --out or --kid.`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const x = publicKey.export({ format: "jwk" }).x;
  console.log(`Private key: ${out}`);
  console.log("Keep it secret. Back it up somewhere safe.\n");
  console.log("Add this line to LICENSE_PUBLIC_KEYS in packages/core/src/server/license-keys.ts:\n");
  console.log(`  "${kid}": "${x}"`);
}

function issue(f) {
  for (const k of ["key", "kid", "licensee", "plan", "expires"]) if (!f[k]) fail(`--${k} is required.`);
  if (!PLANS.includes(f.plan)) fail(`--plan must be ${PLANS.join(" or ")}.`);
  const issuedAt = f.issued ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(issuedAt) || !DATE.test(f.expires)) fail("Dates must look like 2027-11-10.");
  if (f.expires < issuedAt) fail("--expires must be on or after the issue date.");
  const payload = {
    id: f.id ?? `lic_${issuedAt.replace(/-/g, "")}_${randomBytes(4).toString("hex")}`,
    kid: f.kid,
    licensee: f.licensee.trim(),
    plan: f.plan,
    issuedAt,
    expiresAt: f.expires,
    ...(f.hosts ? { hosts: f.hosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean) } : {})
  };
  const key = createPrivateKey(readFileSync(expandHome(f.key)));
  if (key.asymmetricKeyType !== "ed25519") fail("--key must be an Ed25519 private key from `npm run license -- keygen`.");
  const signed = `oa1.${b64url(JSON.stringify(payload))}`;
  const signature = sign(null, Buffer.from(signed), key);
  console.error(JSON.stringify(payload, null, 2));
  console.log(`${signed}.${b64url(signature)}`);
}

function inspect(key) {
  if (!key) fail("Give the license key to inspect.");
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "oa1") fail("This is not an OpenAct license key. It starts with oa1.");
  try {
    console.log(JSON.stringify(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")), null, 2));
  } catch {
    fail("The key is damaged.");
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const f = flags(rest);
switch (cmd) {
  case "keygen":
    keygen(f);
    break;
  case "issue":
    issue(f);
    break;
  case "inspect":
    inspect(f._[0]);
    break;
  default:
    console.log("Usage: npm run license -- keygen [--kid id] [--out file] | issue --key file --kid id --licensee name --plan director|producer --expires YYYY-MM-DD [--hosts a,b] | inspect <key>");
    if (cmd) process.exit(1);
}
