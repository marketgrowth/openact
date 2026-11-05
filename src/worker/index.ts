import { Hono, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Env } from "./env";
import type { AppConfig } from "../shared/types";
import { authRoutes, meRoutes, sessionMiddleware } from "./auth";
import { projectRoutes } from "./projects";
import { attachmentRoutes, columnRoutes, projectTaskRoutes, taskRoutes } from "./tasks";
import { aiRoutes } from "./ai";
import { aguiRoutes } from "./agui";
import { HttpError, appName } from "./util";

const app = new Hono<AppEnv>();

const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
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

app.use("/api/*", securityHeaders, sameOrigin, sessionMiddleware);

app.get("/api/config", (c) => {
  const config: AppConfig = {
    appName: appName(c.env),
    emailEnabled: !!c.env.RESEND_API_KEY,
    signupMode: (c.env.SIGNUP_MODE || "open").trim() === "invite" ? "invite" : "open",
    aiProvider: (c.env.AI_PROVIDER || "workers-ai").trim()
  };
  return c.json(config);
});

app.route("/api/auth", authRoutes);
app.route("/api/me", meRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/projects", projectTaskRoutes);
app.route("/api/projects", aiRoutes);
app.route("/api/projects", aguiRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/columns", columnRoutes);
app.route("/api/attachments", attachmentRoutes);

app.get("/api/health", (c) => c.json({ ok: true }));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "This API route does not exist." }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  console.error("[openact] Unhandled error", err);
  return c.json({ error: "Something went wrong on the server. Try again." }, 500);
});

/** Removes expired sign-in codes and sessions once a day. */
async function cleanup(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE created_at < ?").bind(now - 86400000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    // Approval requests that nobody answered.
    env.DB.prepare("UPDATE agent_actions SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at < ?").bind(
      new Date(now).toISOString(),
      new Date(now - 30 * 60000).toISOString()
    )
  ]);
}

export default {
  fetch: app.fetch,
  scheduled: async (_event, env, ctx) => {
    ctx.waitUntil(cleanup(env));
  }
} satisfies ExportedHandler<Env>;
