import type { Env } from "./env";
import type { CompanyRole } from "../shared/types";
import { HttpError } from "./util";

/** The company role of a person, or null. */
export async function companyRole(env: Env, companyId: string, userId: string): Promise<CompanyRole | null> {
  const row = await env.DB.prepare("SELECT role FROM company_members WHERE company_id = ? AND user_id = ?")
    .bind(companyId, userId)
    .first<{ role: CompanyRole }>();
  return row?.role ?? null;
}

/** Checks the company role. Guests and outsiders get 404, so a company id reveals nothing. */
export async function requireCompanyRole(env: Env, companyId: string, userId: string, allowed: CompanyRole[]): Promise<CompanyRole> {
  const role = await companyRole(env, companyId, userId);
  if (!role) throw new HttpError(404, "This company does not exist, or you are not in it.");
  if (!allowed.includes(role)) {
    throw new HttpError(
      403,
      allowed.includes("admin")
        ? "Only company owners and admins can do this."
        : allowed.includes("member")
          ? "Guests cannot do this. Ask a company admin to make you a member."
          : "Only a company owner can do this."
    );
  }
  return role;
}

/** Deletes every R2 object under a prefix. */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor, limit: 1000 });
    if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
