import { Hono, type MiddlewareHandler } from "hono";
import { companyAllowsSignup, joinCompaniesAtSignIn } from "./companies";
import { getApps, runHook } from "./apps";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "./env";
import type { User } from "../shared/types";
import { signInCodeEmail, sendEmail } from "./email";
import { HttpError, isEmail, newId, normalizeEmail, nowIso, randomToken, readJson, requireUser, sha256Hex, text } from "./util";

/*
 * Passwordless sign-in with a one-time email code.
 * 1. POST /api/auth/request-code  { email }        -> a 6-digit code goes to the inbox.
 * 2. POST /api/auth/verify        { email, code }  -> a session cookie is set.
 * Codes and session tokens are stored only as SHA-256 hashes.
 */

export const SESSION_COOKIE = "openact_session";
const SESSION_TTL_MS = 30 * 86400000;
const SESSION_REFRESH_MS = 15 * 86400000;
const CODE_TTL_MS = 10 * 60000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL = 5; // per 15 minutes
const MAX_CODES_PER_IP = 30; // per hour

function randomCode(): string {
  const buf = new Uint32Array(1);
  let n: number;
  // 4_294_000_000 is a multiple of 1_000_000, so the modulo below has no bias.
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, "0");
}

function secretFor(env: Env, url: string): string {
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) return env.AUTH_SECRET;
  const host = new URL(url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return "openact-local-development-only";
  throw new HttpError(500, "The server is missing AUTH_SECRET. Set it with `wrangler secret put AUTH_SECRET`.");
}

/** The server secret (AUTH_SECRET) for apps that seal or sign values. Localhost runs without it. Throws 500 when it is missing. */
export const authSecret = (env: Env, url: string): string => secretFor(env, url);

const hashCode = (secret: string, email: string, code: string) => sha256Hex(`${secret}|${email}|${code}`);

async function checkSignupAllowed(env: Env, email: string): Promise<void> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return;
  const anyUser = await env.DB.prepare("SELECT id FROM users LIMIT 1").first();
  if (!anyUser) return; // The first person can always sign up.
  if ((await runHook("allowSignup", env, email)).some(Boolean)) return; // An app invitation overrides the sign-up limits.
  if (await companyAllowsSignup(env, email)) return; // So does a company invitation or a company's email domain.
  if ((env.SIGNUP_MODE || "open").trim() === "invite") {
    throw new HttpError(403, "There is no account for this email. Ask a project owner or a company admin to invite you.");
  }
  const domains = (env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length && !domains.includes(email.split("@")[1])) {
    throw new HttpError(403, "Sign-up is limited to approved email domains. Ask a project owner to invite you.");
  }
}

async function createSession(c: Parameters<MiddlewareHandler<AppEnv>>[0], userId: string): Promise<void> {
  const token = randomToken(32);
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, (c.req.header("user-agent") || "").slice(0, 200), now, now + SESSION_TTL_MS)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000
  });
}

/** Reads the session cookie and puts the user (or null) on the context. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token && token.length >= 20 && token.length <= 100) {
    const id = await sha256Hex(token);
    const row = await c.env.DB.prepare("SELECT s.expires_at, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?")
      .bind(id)
      .first<{ expires_at: number; id: string; email: string; name: string }>();
    const now = Date.now();
    if (row && row.expires_at > now) {
      c.set("user", { id: row.id, email: row.email, name: row.name });
      if (row.expires_at - now < SESSION_REFRESH_MS) {
        c.executionCtx.waitUntil(
          c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
            .bind(now + SESSION_TTL_MS, id)
            .run()
        );
      }
    } else if (row) {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
    }
  }
  await next();
};

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/request-code", async (c) => {
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) throw new HttpError(400, "Type a valid email address.");
  const secret = secretFor(c.env, c.req.url);
  await checkSignupAllowed(c.env, email);

  const now = Date.now();
  const ip = c.req.header("cf-connecting-ip") || "local";
  const perEmail = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?")
    .bind(email, now - 15 * 60000)
    .first<{ n: number }>();
  if ((perEmail?.n ?? 0) >= MAX_CODES_PER_EMAIL) throw new HttpError(429, "Too many codes were sent. Wait 15 minutes, then try again.");
  const perIp = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE ip = ? AND created_at > ?")
    .bind(ip, now - 3600000)
    .first<{ n: number }>();
  if ((perIp?.n ?? 0) >= MAX_CODES_PER_IP) throw new HttpError(429, "Too many sign-in attempts. Wait an hour, then try again.");

  const code = randomCode();
  await c.env.DB.batch([
    // Only the newest code works.
    c.env.DB.prepare("UPDATE login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(now, email),
    c.env.DB.prepare("INSERT INTO login_codes (id, email, code_hash, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      newId(),
      email,
      await hashCode(secret, email, code),
      ip,
      now,
      now + CODE_TTL_MS
    )
  ]);
  await sendEmail(c.env, signInCodeEmail(c.env, email, code));
  return c.json({ ok: true });
});

authRoutes.post("/verify", async (c) => {
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  const code = text(body.code, "Code", { max: 12, required: true }).replace(/\s+/g, "");
  if (!isEmail(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, "Type the 6-digit code from the email.");
  const secret = secretFor(c.env, c.req.url);
  const now = Date.now();

  const row = await c.env.DB.prepare(
    "SELECT id, code_hash, attempts, expires_at FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1"
  )
    .bind(email)
    .first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row || row.expires_at < now || row.attempts >= MAX_ATTEMPTS) {
    if (row) await c.env.DB.prepare("UPDATE login_codes SET used_at = ? WHERE id = ?").bind(now, row.id).run();
    throw new HttpError(400, "This code is expired. Ask for a new code.");
  }
  if ((await hashCode(secret, email, code)) !== row.code_hash) {
    await c.env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    const left = MAX_ATTEMPTS - row.attempts - 1;
    throw new HttpError(
      400,
      left > 0 ? `The code is not correct. You have ${left} more ${left === 1 ? "try" : "tries"}.` : "The code is not correct. Ask for a new code."
    );
  }
  await c.env.DB.prepare("UPDATE login_codes SET used_at = ? WHERE id = ?").bind(now, row.id).run();

  // Find or create the user.
  let user = await c.env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?").bind(email).first<User>();
  const iso = nowIso();
  if (!user) {
    // Re-check limits: settings or invitations can change between the two steps.
    await checkSignupAllowed(c.env, email);
    user = { id: newId(), email, name: email.split("@")[0] };
    await c.env.DB.prepare("INSERT INTO users (id, email, name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)")
      .bind(user.id, user.email, user.name, iso, iso)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(iso, user.id).run();
  }

  // Apps turn their pending invitations for this email into access. A failure here never blocks a sign-in.
  for (const app of getApps()) {
    if (app.hooks?.signedIn) await app.hooks.signedIn(c.env, user).catch((e) => console.error(`[openact] ${app.id} sign-in hook failed`, e));
  }

  await joinCompaniesAtSignIn(c.env, user).catch((e) => console.error("[openact] joining companies at sign-in failed", e));

  await createSession(c, user.id);
  return c.json({ user });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token)
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
      .bind(await sha256Hex(token))
      .run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/* The signed-in person */

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", (c) => c.json({ user: requireUser(c) }));

meRoutes.patch("/", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const name = text(body.name, "Name", { max: 80, required: true });
  await c.env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run();
  return c.json({ user: { ...user, name } });
});

/** Signs the person out on every device. */
meRoutes.post("/sign-out-everywhere", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
