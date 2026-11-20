import type { Env } from "./env";
import { HttpError, newId, sha256Hex } from "./util.ts";

/*
 * Sign-in codes in D1: how a code is saved, and how a typed code is checked.
 * Every limit is checked and changed in one SQL statement, so requests that arrive at the same time
 * cannot pass a limit together. No Hono, so tests can run this file on SQLite.
 *
 * `attempts` counts wrong tries. A try is counted before the code is compared. A correct try gives its count back.
 */

export const CODE_TTL_MS = 10 * 60000;
/** Wrong tries for one code. */
export const MAX_ATTEMPTS = 5;
/** Codes for one email in 15 minutes. */
export const MAX_CODES_PER_EMAIL = 5;
/** Codes for one IP address in one hour. */
export const MAX_CODES_PER_IP = 30;
/** Wrong tries for one email in 24 hours. After that, the email gets no new code until the oldest tries are 24 hours old. */
export const MAX_FAILED_PER_DAY = 25;

const EMAIL_WINDOW_MS = 15 * 60000;
const IP_WINDOW_MS = 3600000;
const DAY_MS = 86400000;

export const hashCode = (secret: string, email: string, code: string) => sha256Hex(`${secret}|${email}|${code}`);

const expired = () => new HttpError(400, "This code is expired. Ask for a new code.");

/**
 * Saves a new code for an email, when the limits allow it. Older codes for the email stop working.
 * Throws 429 when a limit is reached. Then nothing changes.
 */
export async function saveCode(env: Env, o: { email: string; ip: string; codeHash: string; now: number }): Promise<void> {
  const id = newId();
  const { email, ip, now } = o;
  // One batch is one transaction: the code is saved only when every count is under its limit,
  // and older codes stop working only when the new code was saved.
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO login_codes (id, email, code_hash, ip, created_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT COUNT(*) FROM login_codes WHERE email = ?2 AND created_at > ?7) < ?8
         AND (SELECT COUNT(*) FROM login_codes WHERE ip = ?4 AND created_at > ?9) < ?10
         AND (SELECT COALESCE(SUM(attempts), 0) FROM login_codes WHERE email = ?2 AND created_at > ?11) < ?12`
    ).bind(
      id,
      email,
      o.codeHash,
      ip,
      now,
      now + CODE_TTL_MS,
      now - EMAIL_WINDOW_MS,
      MAX_CODES_PER_EMAIL,
      now - IP_WINDOW_MS,
      MAX_CODES_PER_IP,
      now - DAY_MS,
      MAX_FAILED_PER_DAY
    ),
    // Only the newest code works.
    env.DB.prepare(
      "UPDATE login_codes SET used_at = ?1 WHERE email = ?2 AND used_at IS NULL AND id != ?3 AND EXISTS (SELECT 1 FROM login_codes WHERE id = ?3)"
    ).bind(now, email, id)
  ]);
  if (insert?.meta.changes) return;

  // No code was saved. Say which limit stopped it.
  const counts = await env.DB.prepare(
    `SELECT (SELECT COALESCE(SUM(attempts), 0) FROM login_codes WHERE email = ?1 AND created_at > ?2) AS failed,
            (SELECT COUNT(*) FROM login_codes WHERE email = ?1 AND created_at > ?3) AS codes`
  )
    .bind(email, now - DAY_MS, now - EMAIL_WINDOW_MS)
    .first<{ failed: number; codes: number }>();
  if ((counts?.failed ?? 0) >= MAX_FAILED_PER_DAY)
    throw new HttpError(429, "Too many wrong codes were typed for this email. Wait 24 hours, then try again.", "sign_in_locked");
  if ((counts?.codes ?? 0) >= MAX_CODES_PER_EMAIL) throw new HttpError(429, "Too many codes were sent. Wait 15 minutes, then try again.");
  throw new HttpError(429, "Too many sign-in attempts. Wait an hour, then try again.");
}

/**
 * Checks a typed code against the newest code of the email, and uses it up when it is correct.
 * Throws 400 when the code is wrong, expired or out of tries. Returns when the code is correct.
 */
export async function useCode(env: Env, o: { email: string; code: string; secret: string; now: number }): Promise<void> {
  const { email, now } = o;
  const row = await env.DB.prepare(
    "SELECT id, code_hash FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1"
  )
    .bind(email)
    .first<{ id: string; code_hash: string }>();
  if (!row) throw expired();

  // Count the try first. Requests at the same time each get their own count, so no code gets more than MAX_ATTEMPTS tries.
  const claimed = await env.DB.prepare(
    "UPDATE login_codes SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL AND attempts < ? AND expires_at >= ? RETURNING attempts"
  )
    .bind(row.id, MAX_ATTEMPTS, now)
    .first<{ attempts: number }>();
  // No try left, or the code is too old. It stays closed: every later try fails here too.
  if (!claimed) throw expired();

  if ((await hashCode(o.secret, email, o.code)) !== row.code_hash) {
    const left = MAX_ATTEMPTS - claimed.attempts;
    throw new HttpError(
      400,
      left > 0 ? `The code is not correct. You have ${left} more ${left === 1 ? "try" : "tries"}.` : "The code is not correct. Ask for a new code."
    );
  }

  // Use the code once. The correct try is not a wrong try, so it gives its count back.
  const used = await env.DB.prepare("UPDATE login_codes SET used_at = ?, attempts = attempts - 1 WHERE id = ? AND used_at IS NULL")
    .bind(now, row.id)
    .run();
  if (!used.meta.changes) {
    // Another request with the same correct code was first. This try was correct too, so it is not a wrong try.
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts - 1 WHERE id = ?").bind(row.id).run();
    throw new HttpError(400, "This code was already used. Ask for a new code.");
  }
}
