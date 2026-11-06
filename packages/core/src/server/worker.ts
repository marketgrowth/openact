import { Hono, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Env } from "./env";
import type { AppConfig } from "../shared/types";
import { authRoutes, meRoutes, sessionMiddleware } from "./auth";
import { companyRoutes } from "./companies";
import { liveChanges } from "./live";
import { HttpError, appName } from "./util";
import { setApps, type ServerApp } from "./apps";
import { companyAppRoutes } from "./company-apps";
import { getCatalog, setCatalog, type AppInfo } from "./permissions";

const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.res.status === 101) return; // A WebSocket upgrade. Its headers cannot change.
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
};

/**
 * Blocks cross-site writes. Browsers send Origin on POST, PATCH and DELETE.
 * The session cookie is also SameSite=Lax. Requests without Origin (curl, scripts) still need the cookie.
 */
const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) throw new HttpError(403, "Cross-site requests are not allowed.");
  }
  await next();
};

/** Removes expired sign-in codes and sessions. */
async function cleanup(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE created_at < ?").bind(now - 86400000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now)
  ]);
}

/** The daily cron. Apps get every cron; the core cleans up on this one. */
export const DAILY_CRON = "17 3 * * *";

/**
 * Builds the Worker from the core and the installed apps.
 * The host's worker entry calls this with the apps from openact.apps.json.
 * `catalog` lists every installed app, also apps with only web code. Without it, the catalog is the server apps.
 */
export function createWorker({ apps, catalog }: { apps: ServerApp[]; catalog?: AppInfo[] }): ExportedHandler<Env> {
  setApps(apps);
  setCatalog(catalog ?? apps.map((a) => ({ id: a.id, name: a.name, enabledByDefault: true })));
  const app = new Hono<AppEnv>();

  app.use("/api/*", securityHeaders, sameOrigin, sessionMiddleware, liveChanges);
  for (const a of apps) for (const m of a.middleware ?? []) app.use("/api/*", m);

  app.get("/api/config", (c) => {
    const config: AppConfig = {
      appName: appName(c.env),
      emailEnabled: !!c.env.RESEND_API_KEY,
      signupMode: (c.env.SIGNUP_MODE || "open").trim() === "invite" ? "invite" : "open",
      aiProvider: (c.env.AI_PROVIDER || "workers-ai").trim(),
      apps: getCatalog().map((a) => ({ id: a.id, name: a.name }))
    };
    return c.json(config);
  });

  app.route("/api/auth", authRoutes);
  app.route("/api/me", meRoutes);
  app.route("/api/companies", companyRoutes);
  app.route("/api/companies", companyAppRoutes);
  for (const a of apps) a.routes?.(app);

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "This API route does not exist." }, 404);
    return c.env.ASSETS.fetch(c.req.raw);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status as ContentfulStatusCode);
    console.error("[openact] Unhandled error", err);
    return c.json({ error: "Something went wrong on the server. Try again." }, 500);
  });

  return {
    fetch: app.fetch,
    scheduled: async (event, env, ctx) => {
      if (event.cron === DAILY_CRON) ctx.waitUntil(cleanup(env));
      for (const a of apps) {
        if (a.scheduled) ctx.waitUntil(a.scheduled(env, event.cron).catch((e) => console.warn(`[openact] ${a.id} scheduled job failed`, e)));
      }
    }
  };
}
