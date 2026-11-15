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
import { HttpError, appName, nowIso, readJson, requireUser } from "./util";
import { setSiteState, siteState, type SiteState } from "./site-state";
import { getCatalog } from "./permissions";

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
    backgroundType: null,
    backgroundUpdatedAt: null,
    appsOff: [],
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
      backgroundType: m.get("background_type") ?? null,
      backgroundUpdatedAt: m.get("background_updated_at") ?? null,
      appsOff: parseAppsOff(m.get("apps_off")),
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
    canEdit,
    signIn: { ...signInPage(s), customHeading: !!s.signInHeading },
    // Only super admins need the app switches.
    ...(canEdit ? { apps: getCatalog().map((a) => ({ id: a.id, name: a.name, enabled: !s.appsOff.includes(a.id) })) } : {})
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
