import { Hono, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Env } from "./env";
import type { AppConfig } from "../shared/types";
import { authRoutes, meRoutes, sessionMiddleware } from "./auth";
import { projectRoutes } from "./projects";
import { companyRoutes } from "./companies";
import { processVectorOutbox, searchRoutes, vectorsEnabled } from "./search";
import { liveChanges, liveRoutes } from "./live";

// The Durable Object class must be exported from the main module.
export { ProjectRoom } from "./live";
import { attachmentRoutes, columnRoutes, projectTaskRoutes, taskRoutes } from "./tasks";
import { aiRoutes } from "./ai";
import { aguiRoutes } from "./agui";
import { HttpError, appName } from "./util";

const app = new Hono<AppEnv>();

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

/** After a change, index the changed tasks for search in the background. */
const indexAfterWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.req.method !== "GET" && vectorsEnabled(c.env)) {
    c.executionCtx.waitUntil(processVectorOutbox(c.env, 32).catch((e) => console.warn("[openact] search indexing failed", e)));
  }
};

app.use("/api/*", securityHeaders, sameOrigin, sessionMiddleware, liveChanges, indexAfterWrites);

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
app.route("/api/companies", companyRoutes);
app.route("/api/projects", liveRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/projects", projectTaskRoutes);
app.route("/api/projects", aiRoutes);
app.route("/api/projects", aguiRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/columns", columnRoutes);
app.route("/api/attachments", attachmentRoutes);
app.route("/api/search", searchRoutes);

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
  scheduled: async (event, env, ctx) => {
    if (event.cron === "17 3 * * *") ctx.waitUntil(cleanup(env));
    // Catch up on search indexing that did not finish after a request.
    ctx.waitUntil(
      (async () => {
        for (let i = 0; i < 6; i++) {
          const r = await processVectorOutbox(env, 64);
          if (!r.indexed && !r.deleted) break;
        }
      })().catch((e) => console.warn("[openact] search indexing failed", e))
    );
  }
} satisfies ExportedHandler<Env>;
