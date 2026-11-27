import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import type { SignInPage, User } from "../shared/types";
import {
  DEFAULT_SIGN_IN_CREDIT,
  DEFAULT_SIGN_IN_HEADING,
  SIGN_IN_BACKGROUND_MAX_BYTES,
  SIGN_IN_CREDIT_MAX,
  SIGN_IN_HEADING_MAX,
  SITE_LOGO_MAX_BYTES,
  SITE_LOGO_TYPES,
  cleanLegalUrl,
  cleanSignInText,
  cleanSiteName,
  isSuperAdminEmail,
  parseAppsOff,
  signInBackgroundUrl,
  siteLogoUrl,
  type SiteSettings
} from "../shared/site";
import { ONBOARDING_KEY } from "../shared/onboarding";
import { HttpError, appName, nowIso, readJson, requireUser, text } from "./util";
import { getApps } from "./apps";
import { CopyError, MAX_COMPANIES_PER_PERSON, duplicateCompany } from "./company-copy";
import { setSiteState, siteState, type SiteState } from "./site-state";
import { getCatalog } from "./permissions";
import type { DuplicateCompanyResult, SiteCompanies, SiteCompanyApps } from "../shared/site";
import { cleanGrantEnd, grantActive, type GrantUser, type SiteGrants } from "../shared/grants";
import { PLAN_IDS, cleanPlanDescription, isPlanId, planDescriptionKey, planIncludes, type PaidPlan, type PlanId } from "../shared/plans";
import { deployLicense } from "./license";
import { grantCeiling } from "./plans";

/*
 * Site settings: the app name, the logo, the sign-in page and the apps of this deploy.
 * Super admins are the emails in SUPER_ADMIN_EMAILS. They are not a company role.
 * Each Worker isolate keeps the settings for a short time, so a change can take up to 30 seconds to show everywhere.
 */

const TTL_MS = 30_000;
const LOGO_KEY = "site/logo";
const BACKGROUND_KEY = "site/sign-in-background";
const SIGN_IN_KEYS = ["signin_heading", "signin_credit", "terms_url", "privacy_url"] as const;

/** Reads the site settings into this isolate. Before migration 0006 runs, the defaults apply. */
export async function loadSite(env: Env, force = false): Promise<SiteState> {
  const now = Date.now();
  const cached = siteState();
  if (cached && !force && now - cached.at < TTL_MS) return cached;
  let next: SiteState = {
    name: "",
    logoType: null,
    logoUpdatedAt: null,
    signInHeading: "",
    signInCredit: "",
    termsUrl: "",
    privacyUrl: "",
    issuesUrl: "",
    backgroundType: null,
    backgroundUpdatedAt: null,
    appsOff: [],
    planDescriptions: {},
    onboardingOn: true,
    at: now
  };
  try {
    const rows = await env.DB.prepare("SELECT key, value FROM site_settings").all<{ key: string; value: string }>();
    const m = new Map(rows.results.map((r) => [r.key, r.value]));
    next = {
      name: m.get("app_name") ?? "",
      logoType: m.get("logo_type") ?? null,
      logoUpdatedAt: m.get("logo_updated_at") ?? null,
      signInHeading: m.get("signin_heading") ?? "",
      signInCredit: m.get("signin_credit") ?? "",
      termsUrl: m.get("terms_url") ?? "",
      privacyUrl: m.get("privacy_url") ?? "",
      issuesUrl: m.get("issues_url") ?? "",
      backgroundType: m.get("background_type") ?? null,
      backgroundUpdatedAt: m.get("background_updated_at") ?? null,
      appsOff: parseAppsOff(m.get("apps_off")),
      planDescriptions: Object.fromEntries(
        PLAN_IDS.map((id) => [id, m.get(planDescriptionKey(id)) ?? ""]).filter(([, v]) => v)
      ) as Partial<Record<PlanId, string>>,
      onboardingOn: m.get(ONBOARDING_KEY) !== "0",
      at: now
    };
  } catch (e) {
    if (!/no such table/i.test(String(e))) console.warn("[openact] Could not read the site settings", e);
  }
  setSiteState(next);
  return next;
}

/** Loads the site settings before each API request, so the app name in replies and emails is current. */
export const siteMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await loadSite(c.env);
  await next();
};

/** The logo URL for the current settings, or null. */
export function siteLogo(s: SiteState | null = siteState()): string | null {
  return s?.logoType && s.logoUpdatedAt ? siteLogoUrl(s.logoUpdatedAt) : null;
}

/** What the sign-in page shows for the current settings. Without a custom heading, the default heading and credit show. */
export function signInPage(s: SiteState | null = siteState()): SignInPage {
  const custom = !!s?.signInHeading;
  return {
    heading: custom ? s!.signInHeading : DEFAULT_SIGN_IN_HEADING,
    credit: custom ? s!.signInCredit : DEFAULT_SIGN_IN_CREDIT,
    termsUrl: s?.termsUrl || null,
    privacyUrl: s?.privacyUrl || null,
    backgroundUrl: s?.backgroundType && s.backgroundUpdatedAt ? signInBackgroundUrl(s.backgroundUpdatedAt) : null
  };
}

/** True when this person is a super admin of the deploy. */
export function isSuperAdmin(env: Env, user: Pick<User, "email"> | null): boolean {
  return !!user && isSuperAdminEmail(env.SUPER_ADMIN_EMAILS, user.email);
}

/** Throws 403 unless the signed-in person is a super admin. */
export function requireSuperAdmin(c: Context<AppEnv>): User {
  const user = requireUser(c);
  if (!isSuperAdmin(c.env, user)) throw new HttpError(403, "Only a super admin can change the site settings. Ask the person who runs this deploy.", "not_super_admin");
  return user;
}

function settings(c: Context<AppEnv>, s: SiteState): SiteSettings {
  const canEdit = isSuperAdmin(c.env, c.get("user"));
  return {
    appName: appName(c.env),
    defaultName: (c.env.APP_NAME || "OpenAct").trim(),
    customName: !!s.name,
    logoUrl: siteLogo(s),
    issuesUrl: s.issuesUrl || null,
    canEdit,
    onboardingEnabled: s.onboardingOn,
    signIn: { ...signInPage(s), customHeading: !!s.signInHeading },
    // Only super admins need the app switches.
    ...(canEdit ? { apps: getCatalog().map((a) => ({ id: a.id, name: a.name, enabled: !s.appsOff.includes(a.id), ...(a.reviewed === false ? { reviewed: false } : {}) })) } : {})
  };
}


const upsert = (env: Env, key: string, value: string, userId: string, iso: string) =>
  env.DB.prepare(
    "INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
  ).bind(key, value, userId, iso);

async function write(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  try {
    await env.DB.batch(statements);
  } catch (e) {
    if (/no such table/i.test(String(e))) throw new HttpError(503, "The site settings table is missing. Run the database migrations, then try again.");
    throw e;
  }
}

export const siteRoutes = new Hono<AppEnv>();

siteRoutes.get("/", async (c) => {
  requireUser(c);
  return c.json(settings(c, await loadSite(c.env)));
});

siteRoutes.patch("/", async (c) => {
  const user = requireSuperAdmin(c);
  const body = await readJson(c);
  const r = cleanSiteName(body.appName);
  if ("problem" in r) throw new HttpError(400, r.problem);
  await write(c.env, [
    r.name ? upsert(c.env, "app_name", r.name, user.id, nowIso()) : c.env.DB.prepare("DELETE FROM site_settings WHERE key = 'app_name'")
  ]);
  return c.json(settings(c, await loadSite(c.env, true)));
});

/**
 * Turns onboarding on or off. Body: { enabled: boolean }
 * On (the default): a new person with no company sets one up. Off: they use New company in the menu.
 */
siteRoutes.patch("/onboarding", async (c) => {
  const user = requireSuperAdmin(c);
  const body = await readJson(c);
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "Enabled must be true or false.");
  await write(c.env, [
    body.enabled ? c.env.DB.prepare("DELETE FROM site_settings WHERE key = ?").bind(ONBOARDING_KEY) : upsert(c.env, ONBOARDING_KEY, "0", user.id, nowIso())
  ]);
  return c.json(settings(c, await loadSite(c.env, true)));
});

/**
 * Saves the Submit issues link. Body: { issuesUrl }
 * The link opens in a new browser tab from an icon on the app rail. An empty link hides the icon.
 */
siteRoutes.patch("/issues", async (c) => {
  const user = requireSuperAdmin(c);
  const r = cleanLegalUrl((await readJson(c)).issuesUrl, "Submit issues");
  if ("problem" in r) throw new HttpError(400, r.problem);
  await write(c.env, [
    r.url ? upsert(c.env, "issues_url", r.url, user.id, nowIso()) : c.env.DB.prepare("DELETE FROM site_settings WHERE key = 'issues_url'")
  ]);
  return c.json(settings(c, await loadSite(c.env, true)));
});

/**
 * Turns an app on or off for the whole site. Body: { enabled: boolean }
 * An app that is off is off in every company. Its data stays, so a super admin can turn it on again.
 */
siteRoutes.patch("/apps/:appId", async (c) => {
  const user = requireSuperAdmin(c);
  const appId = c.req.param("appId");
  const info = getCatalog().find((a) => a.id === appId);
  if (!info) throw new HttpError(404, "This app is not installed.");
  const body = await readJson(c);
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "Enabled must be true or false.");
  const s = await loadSite(c.env, true);
  const off = new Set(s.appsOff.filter((id) => getCatalog().some((a) => a.id === id)));
  if (body.enabled) off.delete(appId);
  else off.add(appId);
  if (getCatalog().every((a) => off.has(a.id))) throw new HttpError(400, "Keep at least one app on for the site. Turn on another app first.");
  await write(c.env, [upsert(c.env, "apps_off", JSON.stringify([...off]), user.id, nowIso())]);
  return c.json(settings(c, await loadSite(c.env, true)));
});

/*
 * Apps per company: a super admin turns an app off for one company, and leaves it on for the others.
 * A blocked app is off in that company, and its owners and admins cannot turn it on. Its data stays.
 */

interface CompanyRow {
  id: string;
  name: string;
  members: number;
  blocked: string | null;
}

async function readBlocks<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (/no such table/i.test(String(e))) throw new HttpError(503, "The company app blocks table is missing. Run the database migrations, then try again.");
    throw e;
  }
}

const COMPANY_SELECT = `SELECT c.id, c.name,
    (SELECT COUNT(*) FROM company_members m WHERE m.company_id = c.id) AS members,
    (SELECT json_group_array(b.app_id) FROM company_app_blocks b WHERE b.company_id = c.id) AS blocked
  FROM companies c`;

function siteCompany(r: CompanyRow): SiteCompanyApps {
  let blocked: string[] = [];
  try {
    const v: unknown = JSON.parse(r.blocked ?? "[]");
    if (Array.isArray(v)) blocked = v.filter((x): x is string => typeof x === "string");
  } catch {
    blocked = [];
  }
  const installed = new Set(getCatalog().map((a) => a.id));
  return { id: r.id, name: r.name, members: r.members, blocked: blocked.filter((id) => installed.has(id)) };
}

/** GET /api/site/companies?q=  With q: up to 20 companies whose name matches. Without q: the first 50 companies by name. */
siteRoutes.get("/companies", async (c) => {
  requireSuperAdmin(c);
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const s = await loadSite(c.env);
  const apps = getCatalog().map((a) => ({ id: a.id, name: a.name, siteOff: s.appsOff.includes(a.id) }));
  const rows = await readBlocks(() =>
    q.length >= 2
      ? c.env.DB.prepare(`${COMPANY_SELECT} WHERE c.name LIKE ? ESCAPE '\\' ORDER BY c.name COLLATE NOCASE LIMIT 20`)
          .bind(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
          .all<CompanyRow>()
      : c.env.DB.prepare(`${COMPANY_SELECT} ORDER BY c.name COLLATE NOCASE LIMIT 50`).all<CompanyRow>()
  );
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM companies").first<{ n: number }>();
  return c.json({ apps, total: total?.n ?? 0, companies: rows.results.map(siteCompany) } satisfies SiteCompanies);
});

/** Makes an app available or not available in one company. Body: { available: boolean } */
siteRoutes.put("/companies/:companyId/apps/:appId", async (c) => {
  const user = requireSuperAdmin(c);
  const { companyId, appId } = c.req.param();
  const info = getCatalog().find((a) => a.id === appId);
  if (!info) throw new HttpError(404, "This app is not installed.");
  const body = await readJson(c);
  if (typeof body.available !== "boolean") throw new HttpError(400, "Available must be true or false.");
  const exists = await c.env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first();
  if (!exists) throw new HttpError(404, "This company does not exist. It may have been deleted.");
  if (body.available) {
    await readBlocks(() => c.env.DB.prepare("DELETE FROM company_app_blocks WHERE company_id = ? AND app_id = ?").bind(companyId, appId).run());
  } else {
    await readBlocks(() =>
      c.env.DB.prepare("INSERT INTO company_app_blocks (company_id, app_id, blocked_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (company_id, app_id) DO NOTHING")
        .bind(companyId, appId, user.id, nowIso())
        .run()
    );
  }
  const row = await c.env.DB.prepare(`${COMPANY_SELECT} WHERE c.id = ?`).bind(companyId).first<CompanyRow>();
  return c.json(siteCompany(row!));
});

/**
 * Duplicates a company. Body: { name }
 * The new company gets a copy of the company's content, such as projects and docs. The super admin is its only owner.
 * People, invitations, the plan, the AI key, the email domain, comments and share links are not copied.
 */
siteRoutes.post("/companies/:companyId/duplicate", async (c) => {
  const user = requireSuperAdmin(c);
  const name = text((await readJson(c)).name, "Company name", { max: 80, required: true });
  const owned = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM company_members WHERE user_id = ? AND role = 'owner'").bind(user.id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_COMPANIES_PER_PERSON)
    throw new HttpError(
      400,
      `You own ${MAX_COMPANIES_PER_PERSON} companies, which is the limit. Make another person an owner of one and leave it, or delete one. Then try again.`
    );
  try {
    const r = await duplicateCompany(c.env, { fromId: c.req.param("companyId"), name, userId: user.id }, getApps());
    return c.json({ company: { id: r.id, name }, copied: r.copied } satisfies DuplicateCompanyResult, 201);
  } catch (err) {
    if (err instanceof CopyError) throw new HttpError(err.status, err.message);
    throw err;
  }
});

/**
 * Saves the sign-in page text and links. Body: { heading, credit, termsUrl, privacyUrl }
 * An empty heading brings back the default heading and credit. An empty link hides that link.
 */
siteRoutes.patch("/sign-in", async (c) => {
  const user = requireSuperAdmin(c);
  const body = await readJson(c);
  const heading = cleanSignInText(body.heading, "Heading", SIGN_IN_HEADING_MAX);
  if ("problem" in heading) throw new HttpError(400, heading.problem);
  const credit = cleanSignInText(body.credit, "Credit", SIGN_IN_CREDIT_MAX);
  if ("problem" in credit) throw new HttpError(400, credit.problem);
  const terms = cleanLegalUrl(body.termsUrl, "Terms of Use");
  if ("problem" in terms) throw new HttpError(400, terms.problem);
  const privacy = cleanLegalUrl(body.privacyUrl, "Privacy Policy");
  if ("problem" in privacy) throw new HttpError(400, privacy.problem);
  const values: Record<(typeof SIGN_IN_KEYS)[number], string> = {
    signin_heading: heading.text,
    // A credit without a heading would show under the default heading, so it is not kept.
    signin_credit: heading.text ? credit.text : "",
    terms_url: terms.url,
    privacy_url: privacy.url
  };
  const iso = nowIso();
  await write(
    c.env,
    SIGN_IN_KEYS.map((k) => (values[k] ? upsert(c.env, k, values[k], user.id, iso) : c.env.DB.prepare("DELETE FROM site_settings WHERE key = ?").bind(k)))
  );
  return c.json(settings(c, await loadSite(c.env, true)));
});

/* The sign-in background is public, because the sign-in page shows it. */
siteRoutes.get("/sign-in-background", async (c) => {
  const s = await loadSite(c.env);
  if (!s.backgroundType) throw new HttpError(404, "This site has no sign-in background.");
  const obj = await c.env.FILES.get(BACKGROUND_KEY);
  if (!obj) throw new HttpError(404, "The background file is missing. Upload it again.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": s.backgroundType,
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
});

siteRoutes.put("/sign-in-background", async (c) => {
  const user = requireSuperAdmin(c);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Choose an image file.");
  if (!(SITE_LOGO_TYPES as readonly string[]).includes(file.type)) throw new HttpError(400, "Use a PNG, JPEG or WebP image.");
  if (file.size > SIGN_IN_BACKGROUND_MAX_BYTES) throw new HttpError(400, "The background must be 3 MB or smaller.");
  await c.env.FILES.put(BACKGROUND_KEY, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const iso = nowIso();
  await write(c.env, [upsert(c.env, "background_type", file.type, user.id, iso), upsert(c.env, "background_updated_at", iso, user.id, iso)]);
  return c.json(settings(c, await loadSite(c.env, true)));
});

/* Removing the background brings back the default stage. */
siteRoutes.delete("/sign-in-background", async (c) => {
  requireSuperAdmin(c);
  await write(c.env, [c.env.DB.prepare("DELETE FROM site_settings WHERE key IN ('background_type', 'background_updated_at')")]);
  await c.env.FILES.delete(BACKGROUND_KEY);
  return c.json(settings(c, await loadSite(c.env, true)));
});

/* The logo is public, because the sign-in page shows it. */
siteRoutes.get("/logo", async (c) => {
  const s = await loadSite(c.env);
  if (!s.logoType) throw new HttpError(404, "This site has no logo.");
  const obj = await c.env.FILES.get(LOGO_KEY);
  if (!obj) throw new HttpError(404, "The logo file is missing. Upload it again.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": s.logoType,
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
});

siteRoutes.put("/logo", async (c) => {
  const user = requireSuperAdmin(c);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Choose an image file.");
  if (!(SITE_LOGO_TYPES as readonly string[]).includes(file.type)) throw new HttpError(400, "Use a PNG, JPEG or WebP image.");
  if (file.size > SITE_LOGO_MAX_BYTES) throw new HttpError(400, "The logo must be 1 MB or smaller.");
  await c.env.FILES.put(LOGO_KEY, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const iso = nowIso();
  await write(c.env, [upsert(c.env, "logo_type", file.type, user.id, iso), upsert(c.env, "logo_updated_at", iso, user.id, iso)]);
  return c.json(settings(c, await loadSite(c.env, true)));
});

siteRoutes.delete("/logo", async (c) => {
  requireSuperAdmin(c);
  await write(c.env, [c.env.DB.prepare("DELETE FROM site_settings WHERE key IN ('logo_type', 'logo_updated_at')")]);
  await c.env.FILES.delete(LOGO_KEY);
  return c.json(settings(c, await loadSite(c.env, true)));
});

/**
 * Saves the description under a plan name on the Plan page. Body: { description }
 * An empty description brings back the default. Every company on the site sees the same text.
 */
siteRoutes.patch("/plans/:planId", async (c) => {
  const user = requireSuperAdmin(c);
  const planId = c.req.param("planId");
  if (!isPlanId(planId)) throw new HttpError(404, "This plan does not exist. Use free, director or producer.");
  const r = cleanPlanDescription((await readJson(c)).description);
  if ("problem" in r) throw new HttpError(400, r.problem);
  const key = planDescriptionKey(planId);
  await write(c.env, [r.text ? upsert(c.env, key, r.text, user.id, nowIso()) : c.env.DB.prepare("DELETE FROM site_settings WHERE key = ?").bind(key)]);
  const s = await loadSite(c.env, true);
  return c.json({ plan: planId, description: s.planDescriptions[planId] ?? "" });
});

/*
 * Paid app access: a super admin gives one person a paid app without a paid plan.
 * The grant unlocks the app in every company where the person is an owner. See ownerGrants() in plans.ts.
 */

const paidApps = () => getCatalog().filter((a): a is typeof a & { plan: PaidPlan } => !!a.plan);

/** The paid apps that the deploy's license key lets a super admin grant. */
async function grantableApps(c: Context<AppEnv>) {
  const ceiling = grantCeiling(await deployLicense(c.env, c.req.url));
  return paidApps().filter((a) => planIncludes(ceiling, a.plan));
}

interface GrantRow {
  id: string;
  name: string;
  email: string;
  owner_of: number;
  app_id: string | null;
  ends_on: string | null;
  created_at: string | null;
}

/** Groups rows of users joined with their grants. Keeps the row order. Grants for apps that are not installed or not paid are left out. */
function grantUsers(rows: GrantRow[], now = Date.now()): GrantUser[] {
  const paid = new Set(paidApps().map((a) => a.id));
  const byId = new Map<string, GrantUser>();
  for (const r of rows) {
    let u = byId.get(r.id);
    if (!u) {
      u = {
        id: r.id,
        name: r.name,
        email: r.email,
        ownerOf: r.owner_of,
        grants: []
      };
      byId.set(r.id, u);
    }
    if (r.app_id && paid.has(r.app_id))
      u.grants.push({
        appId: r.app_id,
        endsOn: r.ends_on,
        active: grantActive(r.ends_on, now),
        createdAt: r.created_at ?? ""
      });
  }
  return [...byId.values()];
}

const GRANT_SELECT = `SELECT u.id, u.name, u.email,
    (SELECT COUNT(*) FROM company_members m WHERE m.user_id = u.id AND m.role = 'owner') AS owner_of,
    g.app_id, g.ends_on, g.created_at
  FROM users u LEFT JOIN app_grants g ON g.user_id = u.id`;

async function readGrants<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (/no such table/i.test(String(e))) throw new HttpError(503, "The app grants table is missing. Run the database migrations, then try again.");
    throw e;
  }
}

async function grantUser(env: Env, userId: string): Promise<GrantUser | null> {
  const rows = await readGrants(() => env.DB.prepare(`${GRANT_SELECT} WHERE u.id = ? ORDER BY g.app_id`).bind(userId).all<GrantRow>());
  return grantUsers(rows.results)[0] ?? null;
}

/** GET /api/site/grants?q=  With q: up to 20 people whose name or email matches. Without q: everyone with a grant. */
siteRoutes.get("/grants", async (c) => {
  requireSuperAdmin(c);
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const apps = (await grantableApps(c)).map((a) => ({ id: a.id, name: a.name, plan: a.plan }));
  const needsLicense = paidApps().length > apps.length;
  if (!apps.length) return c.json({ apps, needsLicense, users: [] } satisfies SiteGrants);
  const rows = await readGrants(() =>
    q.length >= 2
      ? c.env.DB.prepare(
          `${GRANT_SELECT} WHERE u.id IN (
             SELECT id FROM users WHERE email LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' ORDER BY email LIMIT 20
           ) ORDER BY u.email, g.app_id`
        )
          .bind(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
          .all<GrantRow>()
      : c.env.DB.prepare(`${GRANT_SELECT} WHERE u.id IN (SELECT user_id FROM app_grants) ORDER BY u.email, g.app_id LIMIT 1000`).all<GrantRow>()
  );
  return c.json({ apps, needsLicense, users: grantUsers(rows.results) } satisfies SiteGrants);
});

/** Gives a person a paid app, or changes the end day. Body: { endsOn: "YYYY-MM-DD" | null } */
siteRoutes.put("/grants/:userId/:appId", async (c) => {
  const admin = requireSuperAdmin(c);
  const { userId, appId } = c.req.param();
  if (!paidApps().some((a) => a.id === appId)) throw new HttpError(400, "Only paid apps can be given to a person. This app is free or not installed.");
  if (!(await grantableApps(c)).some((a) => a.id === appId))
    throw new HttpError(
      403,
      "This deploy's license key does not allow grants for this app. Ask MarketGrowth for a key that allows them, then put it in OPENACT_LICENSE.",
      "grants_need_license"
    );
  const r = cleanGrantEnd((await readJson(c)).endsOn);
  if ("problem" in r) throw new HttpError(400, r.problem);
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!exists) throw new HttpError(404, "This person does not have an account on this site.");
  const iso = nowIso();
  await readGrants(() =>
    c.env.DB.prepare(
      `INSERT INTO app_grants (user_id, app_id, ends_on, granted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, app_id) DO UPDATE SET ends_on = excluded.ends_on, granted_by = excluded.granted_by, updated_at = excluded.updated_at`
    )
      .bind(userId, appId, r.endsOn, admin.id, iso, iso)
      .run()
  );
  return c.json(await grantUser(c.env, userId));
});

/** Takes a paid app back. The app locks again in the person's companies, unless they have a plan. Its data stays. */
siteRoutes.delete("/grants/:userId/:appId", async (c) => {
  requireSuperAdmin(c);
  const { userId, appId } = c.req.param();
  await readGrants(() => c.env.DB.prepare("DELETE FROM app_grants WHERE user_id = ? AND app_id = ?").bind(userId, appId).run());
  const user = await grantUser(c.env, userId);
  if (!user) throw new HttpError(404, "This person does not have an account on this site.");
  return c.json(user);
});
