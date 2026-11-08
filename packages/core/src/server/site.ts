import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import type { User } from "../shared/types";
import { SITE_LOGO_MAX_BYTES, SITE_LOGO_TYPES, cleanSiteName, isSuperAdminEmail, siteLogoUrl, type SiteSettings } from "../shared/site";
import { HttpError, appName, nowIso, readJson, requireUser } from "./util";
import { setSiteState, siteState, type SiteState } from "./site-state";

/*
 * Site settings: the app name and logo of this deploy.
 * Super admins are the emails in SUPER_ADMIN_EMAILS. They are not a company role.
 * Each Worker isolate keeps the settings for a short time, so a change can take up to 30 seconds to show everywhere.
 */

const TTL_MS = 30_000;
const LOGO_KEY = "site/logo";

/** Reads the site settings into this isolate. Before migration 0006 runs, the defaults apply. */
export async function loadSite(env: Env, force = false): Promise<SiteState> {
  const now = Date.now();
  const cached = siteState();
  if (cached && !force && now - cached.at < TTL_MS) return cached;
  let next: SiteState = { name: "", logoType: null, logoUpdatedAt: null, at: now };
  try {
    const rows = await env.DB.prepare("SELECT key, value FROM site_settings").all<{ key: string; value: string }>();
    const m = new Map(rows.results.map((r) => [r.key, r.value]));
    next = { name: m.get("app_name") ?? "", logoType: m.get("logo_type") ?? null, logoUpdatedAt: m.get("logo_updated_at") ?? null, at: now };
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
  return {
    appName: appName(c.env),
    defaultName: (c.env.APP_NAME || "OpenAct").trim(),
    customName: !!s.name,
    logoUrl: siteLogo(s),
    canEdit: isSuperAdmin(c.env, c.get("user"))
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
