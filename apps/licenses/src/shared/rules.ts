/*
 * Rules for the License Keys app. Both the Worker and the web app use them, and tests load this file directly.
 * The license format is the core's: oa1.<base64url JSON payload>.<base64url Ed25519 signature>. See docs/plans.md.
 */

export const PLANS = ["director", "producer"] as const;
export type Plan = (typeof PLANS)[number];
export const USES = ["plan", "grants"] as const;
export type Use = (typeof USES)[number];

export const LICENSEE_MAX = 120;
export const NOTE_MAX = 500;
export const HOSTS_MAX = 10;
/** The longest license: 5 years. */
export const MAX_YEARS = 5;

export interface SigningKey {
  kid: string;
  publicKey: string;
  createdAt: string;
  retiredAt: string | null;
  /** The line to add to LICENSE_PUBLIC_KEYS in packages/core/src/server/license-keys.ts. */
  releaseLine: string;
  /** True when this build of OpenAct already trusts the key. */
  released: boolean;
  /** The number of licenses it signed. */
  licenses: number;
}

export interface IssuedLicense {
  id: string;
  kid: string;
  licensee: string;
  plan: Plan;
  use: Use;
  hosts: string[];
  issuedAt: string;
  expiresAt: string;
  note: string;
  license: string;
  createdAt: string;
  /** valid, grace (expired, inside the 14 grace days) or expired. */
  time: "valid" | "grace" | "expired";
}

export interface LicensesState {
  signingKeys: SigningKey[];
  licenses: IssuedLicense[];
}

export interface Inspection {
  payload: Record<string, unknown>;
  /** Signed by a key that this app holds. null: the key id is not one of this app's keys. */
  signedHere: boolean | null;
  /** True when this build of OpenAct trusts the key and the signature is valid. */
  trusted: boolean;
  time: "valid" | "grace" | "expired";
  /** Set when the key is broken or the signature is wrong. */
  problem: string | null;
}

export const today = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d: string) => DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** A key id: 3 to 40 lowercase letters, digits and dashes, such as mg-2026. */
export function cleanKid(raw: unknown): { kid: string } | { problem: string } {
  const kid = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(kid)) return { problem: "Use 3 to 40 lowercase letters, digits and dashes for the key id, such as mg-2026." };
  return { kid };
}

/** Host names: up to 10, separated by commas, spaces or new lines. Empty means any host. */
export function cleanHosts(raw: unknown): { hosts: string[] } | { problem: string } {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const hosts = [...new Set(list.map((h) => (typeof h === "string" ? h.trim().toLowerCase() : "")).filter(Boolean))];
  if (hosts.length > HOSTS_MAX) return { problem: `Use ${HOSTS_MAX} host names or fewer.` };
  for (const h of hosts)
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h))
      return { problem: `"${h}" is not a host name. Use a name such as app.example.com, without https:// or a path.` };
  return { hosts };
}

export interface LicenseInput {
  kid: string;
  licensee: string;
  plan: Plan;
  use: Use;
  hosts: string[];
  issuedAt: string;
  expiresAt: string;
  note: string;
}

/** Checks the issue form. */
export function cleanLicenseInput(body: Record<string, unknown>, now = Date.now()): LicenseInput | { problem: string } {
  const k = cleanKid(body.kid);
  if ("problem" in k) return k;
  const licensee = typeof body.licensee === "string" ? body.licensee.trim() : "";
  if (!licensee) return { problem: "Type the licensee, such as the company name." };
  if (licensee.length > LICENSEE_MAX) return { problem: `Use ${LICENSEE_MAX} characters or fewer for the licensee.` };
  if (!(PLANS as readonly unknown[]).includes(body.plan)) return { problem: "Choose Director or Producer." };
  const use = body.use === undefined ? "plan" : body.use;
  if (!(USES as readonly unknown[]).includes(use)) return { problem: "Choose a use: plan or grants." };
  const h = cleanHosts(body.hosts);
  if ("problem" in h) return h;
  const issuedAt = today(now);
  const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : "";
  if (!realDate(expiresAt)) return { problem: "Choose a real last day, such as 2027-11-15." };
  if (expiresAt < issuedAt) return { problem: "The last day is in the past. Choose today or a later day." };
  const limit = `${Number(issuedAt.slice(0, 4)) + MAX_YEARS}${issuedAt.slice(4)}`;
  if (expiresAt > limit) return { problem: `A license can last ${MAX_YEARS} years at most. Choose ${limit} or an earlier day.` };
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX) return { problem: `Use ${NOTE_MAX} characters or fewer for the note.` };
  return { kid: k.kid, licensee, plan: body.plan as Plan, use: use as Use, hosts: h.hosts, issuedAt, expiresAt, note };
}

/** The payload that goes into the key. Same fields and order as scripts/license.mjs. */
export function licensePayload(id: string, input: LicenseInput) {
  return {
    id,
    kid: input.kid,
    licensee: input.licensee,
    plan: input.plan,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    ...(input.use === "grants" ? { use: "grants" as const } : {}),
    ...(input.hosts.length ? { hosts: input.hosts } : {})
  };
}
