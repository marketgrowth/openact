import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { HttpError, randomToken, readJson, sha256Hex } from "./util.ts";
import { requireSuperAdmin } from "./site.ts";
import { checkLicense, deployHost, deployLicenseSource } from "./license.ts";
import { readSaved, saveClaim, saveLicense } from "./license-store.ts";
import { getCatalog } from "./permissions.ts";
import { licenseTime } from "../shared/plans.ts";
import { DEFAULT_STORE_URL, type DirectorStatus, type InstallResult, type StoreApp, type StoreRepo } from "../shared/store.ts";

/*
 * Buy OpenAct Director and install its apps from Site settings > Plan, on a self-hosted deploy.
 * The Worker talks to the MarketGrowth store (OPENACT_STORE_URL, default https://on.openact.ing). Only super admins.
 *
 *   GET    /api/site/director              DirectorStatus
 *   POST   /api/site/director/checkout     { plan } → { url } of Stripe Checkout
 *   POST   /api/site/director/claim        Fetches the key after checkout. The daily cron does it too.
 *   PUT    /api/site/director/license      { license } saves a key by hand. DELETE removes it.
 *   POST   /api/site/director/github       → { url } to connect the OpenAct Director GitHub App
 *   GET    /api/site/director/repos        The repositories that the app can see
 *   POST   /api/site/director/install      { repo, branch?, apps } → InstallResult
 *
 * The claim token proves that this deploy made the order. It never leaves the Worker except to the store.
 */

const storeUrl = (env: Env) => ((env.OPENACT_STORE_URL || "").trim() || DEFAULT_STORE_URL).replace(/\/+$/, "");

/** Calls the store. Turns its errors into errors the Plan page can show. */
async function callStore<T>(env: Env, method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${storeUrl(env)}/api/apps/licenses/store${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000)
    });
  } catch {
    throw new HttpError(502, "The OpenAct store did not answer. Try again in a few minutes.", "store_unreachable");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : res.status, data.error || `The OpenAct store answered ${res.status}. Try again later.`, data.code);
  return data;
}

/** The store's catalog, kept 10 minutes in each isolate. */
let catalogCache: { at: number; url: string; value: { apps: StoreApp[]; github: boolean; checkout: boolean } | null } | null = null;
async function storeCatalog(env: Env) {
  const url = storeUrl(env);
  if (catalogCache && catalogCache.url === url && Date.now() - catalogCache.at < 600_000) return catalogCache.value;
  let value: { apps: StoreApp[]; github: boolean; checkout: boolean } | null = null;
  try {
    value = await callStore(env, "GET", "/catalog");
  } catch {
    value = null;
  }
  catalogCache = { at: Date.now(), url, value };
  return value;
}

/** What every store call that needs the customer sends: the license key, and the claim token when there is one. */
async function credentials(env: Env, requestUrl: string): Promise<{ license: string; claim?: string }> {
  const lic = await deployLicenseSource(env, requestUrl);
  if (!lic) throw new HttpError(409, "This site has no license key. Buy a plan or add a key first.", "no_license");
  const { claim } = await readSaved(env);
  return { license: lic.key, ...(claim ? { claim } : {}) };
}

/** Asks the store for this deploy's newest key and saves it when it works here. Returns true when a key was saved. */
export async function claimFromStore(env: Env, requestUrl?: string): Promise<{ saved: boolean; status: string | null }> {
  const { claim } = await readSaved(env, true);
  if (!claim) return { saved: false, status: null };
  const r = await callStore<{ status: string; license: string | null; expiresAt: string | null }>(env, "POST", "/claim", { claim });
  if (!r.license) return { saved: false, status: r.status };
  const current = (await readSaved(env, true)).license;
  if (current === r.license) return { saved: false, status: r.status };
  const check = await checkLicense(r.license, { host: deployHost(env, requestUrl) });
  if (!check.ok) {
    console.warn(`[openact] The store sent a license key that does not work here: ${check.error}`);
    return { saved: false, status: r.status };
  }
  await saveLicense(env, r.license, null);
  return { saved: true, status: r.status };
}

/** The daily cron: renew the saved key from the store when the deploy bought through it. Never throws. */
export async function refreshStoreLicense(env: Env): Promise<void> {
  try {
    await claimFromStore(env);
  } catch (e) {
    console.warn("[openact] Could not renew the license key from the store", e);
  }
}

async function status(env: Env, requestUrl: string): Promise<DirectorStatus> {
  const [lic, saved, cat] = await Promise.all([deployLicenseSource(env, requestUrl), readSaved(env), storeCatalog(env)]);
  let license: DirectorStatus["license"] = null;
  let licenseProblem: string | null = null;
  if (lic) {
    const r = lic.result;
    const payload = r.ok ? r.payload : r.ended;
    if (payload) {
      const t = licenseTime(payload);
      license = { source: lic.source, licensee: payload.licensee, plan: payload.plan, expiresAt: payload.expiresAt, state: t === "expired" ? "ended" : t };
    } else if (!r.ok) licenseProblem = r.error;
  }
  return {
    host: deployHost(env),
    license,
    licenseProblem,
    storeOrder: !!saved.claim,
    catalog: cat?.apps ?? null,
    checkout: !!cat?.checkout,
    github: !!cat?.github,
    installed: getCatalog()
      .filter((a) => a.plan)
      .map((a) => ({ id: a.id, name: a.name, version: a.version ?? null })),
    storeUrl: storeUrl(env)
  };
}

/** The Plan page address on this deploy, where the store and GitHub send the person back. */
function planUrl(env: Env, requestUrl: string): string {
  const base = (env.APP_URL || "").trim() || new URL(requestUrl).origin;
  return `${base.replace(/\/+$/, "")}/settings/site/plan`;
}

export const directorRoutes = new Hono<AppEnv>();

directorRoutes.get("/", async (c) => {
  requireSuperAdmin(c);
  return c.json(await status(c.env, c.req.url));
});

directorRoutes.post("/checkout", async (c) => {
  requireSuperAdmin(c);
  const body = await readJson(c);
  const plan = body.plan === "producer" ? "producer" : "director";
  const host = deployHost(c.env);
  if (!host) throw new HttpError(409, "Set APP_URL to this site's address first. A store license works only on that host.", "no_app_url");
  // A new claim for each checkout. The old one stays valid at the store for its own order.
  const claim = randomToken(32);
  const r = await callStore<{ url: string }>(c.env, "POST", "/checkout", {
    plan,
    host,
    returnUrl: planUrl(c.env, c.req.url),
    claimHash: await sha256Hex(claim)
  });
  await saveClaim(c.env, claim, c.get("user")!.id);
  return c.json({ url: r.url });
});

directorRoutes.post("/claim", async (c) => {
  requireSuperAdmin(c);
  const r = await claimFromStore(c.env, c.req.url);
  return c.json({ ...r, director: await status(c.env, c.req.url) });
});

directorRoutes.put("/license", async (c) => {
  const user = requireSuperAdmin(c);
  const raw = (await readJson(c)).license;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) throw new HttpError(400, "Paste the license key. It starts with oa1.");
  const check = await checkLicense(key, { host: deployHost(c.env, c.req.url) });
  if (!check.ok && !check.ended) throw new HttpError(400, check.error, "license_invalid");
  await saveLicense(c.env, key, user.id);
  return c.json(await status(c.env, c.req.url));
});

directorRoutes.delete("/license", async (c) => {
  requireSuperAdmin(c);
  await saveLicense(c.env, null, null);
  return c.json(await status(c.env, c.req.url));
});

directorRoutes.post("/github", async (c) => {
  requireSuperAdmin(c);
  const r = await callStore<{ url: string }>(c.env, "POST", "/github/start", { ...(await credentials(c.env, c.req.url)), returnUrl: planUrl(c.env, c.req.url) });
  return c.json(r);
});

directorRoutes.get("/repos", async (c) => {
  requireSuperAdmin(c);
  return c.json(await callStore<{ repos: StoreRepo[] }>(c.env, "POST", "/repos", await credentials(c.env, c.req.url)));
});

directorRoutes.post("/install", async (c) => {
  requireSuperAdmin(c);
  const body = await readJson(c);
  const apps = Array.isArray(body.apps) ? body.apps.filter((x): x is string => typeof x === "string" && /^[a-z][a-z0-9-]{1,30}$/.test(x)) : [];
  if (!apps.length) throw new HttpError(400, "Choose at least one app.");
  const r = await callStore<InstallResult>(c.env, "POST", "/install", {
    ...(await credentials(c.env, c.req.url)),
    repo: body.repo,
    branch: body.branch || undefined,
    apps
  });
  return c.json(r);
});
