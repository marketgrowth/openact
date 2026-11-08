import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { AppEnv, Env } from "./env";
import { HttpError, normalizeEmail, readJson, requireUser } from "./util";
import { runHook } from "./apps";
import { removeFromCompany } from "./companies";
import { SESSION_COOKIE } from "./auth";

/*
 * Account deletion. A person deletes their own account from the Account dialog.
 * Company data that the person made, such as projects, tasks and files, stays with the company.
 * The person's name leaves it: assignments and "created by" fields become empty.
 */

/** The companies where this person is the only owner. Deleting the account would leave them without an owner. */
export async function soleOwnerCompanies(env: Env, userId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name FROM company_members m JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = ? AND m.role = 'owner'
       AND NOT EXISTS (SELECT 1 FROM company_members o WHERE o.company_id = m.company_id AND o.role = 'owner' AND o.user_id <> m.user_id)
     ORDER BY c.name`
  )
    .bind(userId)
    .all<{ id: string; name: string }>();
  return rows.results;
}

export const accountRoutes = new Hono<AppEnv>();

/** Deletes the signed-in person's account. The body must repeat their email: { "email": "..." }. */
accountRoutes.delete("/", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  if (normalizeEmail(body.email) !== normalizeEmail(user.email)) throw new HttpError(400, "Type your email address to confirm.", "confirm_email");

  const owned = await soleOwnerCompanies(c.env, user.id);
  if (owned.length) {
    const names = owned.map((o) => `"${o.name}"`).join(", ");
    throw new HttpError(
      409,
      `You are the only owner of ${names}. Make another person an owner, or delete the company, then try again.`,
      "sole_owner"
    );
  }

  // Apps remove the person from each company's data first, as when an admin removes them.
  const memberships = await c.env.DB.prepare("SELECT company_id FROM company_members WHERE user_id = ?").bind(user.id).all<{ company_id: string }>();
  for (const m of memberships.results) await removeFromCompany(c.env, m.company_id, user.id);
  await runHook("userDeleting", c.env, user.id);

  // Sessions, memberships, pins and other rows that point to the user go with the user row (ON DELETE CASCADE or SET NULL).
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(user.email),
    c.env.DB.prepare("DELETE FROM invitations WHERE email = ?").bind(user.email),
    c.env.DB.prepare("DELETE FROM company_invitations WHERE email = ?").bind(user.email),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)
  ]);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
