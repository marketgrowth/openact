import { defineServerApp, type Env } from "@openact/core/server";
import { isSuperAdminEmail } from "@openact/core/shared";

/*
 * The nightly reset for the public demo at a.openact.ing. This file lives on the `demo` branch only.
 *
 * When DEMO_RESET is "true", the reset cron deletes all people, companies and app data,
 * and all files except the site logo. It keeps the site settings and the migration history.
 * The table list comes from the database, so new app tables are reset too.
 *
 * Kept companies: DEMO_KEEP_COMPANIES lists company names, such as "MarketGrowth". A company with one of
 * these names is kept only when a super admin (SUPER_ADMIN_EMAILS) owns it, so a visitor cannot keep a
 * company by giving it the same name. The reset keeps that company, its data and files, its people
 * and their sessions. Everything else goes.
 */

interface DemoEnv extends Env {
  /** "true" turns on the nightly reset. Any other value turns it off. */
  DEMO_RESET?: string;
  /** Company names to keep, separated by commas. Only companies that a super admin owns count. */
  DEMO_KEEP_COMPANIES?: string;
}

/** 10:17 UTC: about 2 AM Pacific time in winter and 3 AM in summer. It must also be in wrangler.jsonc. */
export const DEMO_RESET_CRON = "17 10 * * *";

const KEEP_TABLES = new Set(["d1_migrations", "site_settings"]);
const KEEP_FILES = new Set(["site/logo", "site/sign-in-background"]);

export interface ResetResult {
  tables: number;
  files: number;
  vectors: number;
  /** The names of the companies that the reset kept. */
  kept: string[];
}

const keepNames = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);

/** The ids and names of the companies to keep: a name on the list, and a super admin as an owner. */
export async function keptCompanies(env: Env): Promise<Array<{ id: string; name: string }>> {
  const names = keepNames((env as DemoEnv).DEMO_KEEP_COMPANIES);
  if (!names.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT c.id, c.name, u.email FROM companies c
     JOIN company_members m ON m.company_id = c.id AND m.role = 'owner'
     JOIN users u ON u.id = m.user_id`
  ).all<{ id: string; name: string; email: string }>();
  const out = new Map<string, string>();
  for (const r of results)
    if (names.includes(r.name.trim().toLowerCase()) && isSuperAdminEmail(env.SUPER_ADMIN_EMAILS, r.email)) out.set(r.id, r.name);
  return [...out].map(([id, name]) => ({ id, name }));
}

const tableNames = async (env: Env): Promise<string[]> =>
  (
    await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()
  ).results
    .map((r) => r.name)
    .filter((name) => !KEEP_TABLES.has(name));

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function deleteVectors(env: Env, sql: string, binds: unknown[]): Promise<number> {
  if (!env.VECTORS) return 0;
  try {
    const { results } = await env.DB.prepare(sql)
      .bind(...binds)
      .all<{ id: string }>();
    const ids = results.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) await env.VECTORS.deleteByIds(ids.slice(i, i + 500));
    return ids.length;
  } catch (e) {
    console.warn("[openact] demo reset: could not delete task vectors", e);
    return 0;
  }
}

/** Deletes R2 files. `keep` decides which keys stay. */
async function deleteFiles(env: Env, keep: (key: string) => boolean): Promise<number> {
  let files = 0;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key).filter((key) => !KEEP_FILES.has(key) && !keep(key));
    if (keys.length) await env.FILES.delete(keys);
    files += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return files;
}

/** Deletes the demo data, except the kept companies. Returns what it deleted, for the log. */
export async function resetDemo(env: Env): Promise<ResetResult> {
  const kept = await keptCompanies(env);
  const tables = await tableNames(env);

  if (!kept.length) {
    // Remove task vectors first, while the task ids still exist. Search checks access on every result, so a miss here is safe.
    const vectors = await deleteVectors(env, "SELECT id FROM tasks", []);
    // Deferred foreign keys let the deletes run in any order. D1 runs the batch as one transaction.
    await env.DB.batch([env.DB.prepare("PRAGMA defer_foreign_keys = ON"), ...tables.map((name) => env.DB.prepare(`DELETE FROM ${q(name)}`))]);
    const files = await deleteFiles(env, () => false);
    return { tables: tables.length, files, vectors, kept: [] };
  }

  const keep = JSON.stringify(kept.map((k) => k.id));
  const keptIds = "(SELECT value FROM json_each(?1))";
  const vectors = await deleteVectors(
    env,
    `SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.company_id IS NULL OR p.company_id NOT IN ${keptIds}`,
    [keep]
  );

  // Which tables have a company_id column. Most rows go with their company through ON DELETE CASCADE.
  // This also catches app tables without a foreign key to companies.
  const withCompany: string[] = [];
  for (const name of tables) {
    const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`).bind(name).all<{ name: string }>();
    if (name !== "companies" && results.some((c) => c.name === "company_id")) withCompany.push(name);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM companies WHERE id NOT IN " + keptIds).bind(keep),
    env.DB.prepare("DELETE FROM projects WHERE company_id IS NULL OR company_id NOT IN " + keptIds).bind(keep),
    ...withCompany.map((name) => env.DB.prepare(`DELETE FROM ${q(name)} WHERE company_id IS NULL OR company_id NOT IN ${keptIds}`).bind(keep)),
    // People who are not in a kept company. Their sessions, grants and pins go with them.
    env.DB.prepare(`DELETE FROM users WHERE id NOT IN (SELECT user_id FROM company_members WHERE company_id IN ${keptIds})`).bind(keep),
    env.DB.prepare("UPDATE users SET current_company_id = NULL WHERE current_company_id IS NOT NULL AND current_company_id NOT IN (SELECT id FROM companies)"),
    // Sign-in codes are short-lived. Delete jobs for removed tasks are done above.
    env.DB.prepare("DELETE FROM login_codes"),
    env.DB.prepare("DELETE FROM vector_outbox WHERE task_id NOT IN (SELECT id FROM tasks)")
  ]);

  // Files are keyed by company or project id, such as docs/<company>/..., companies/<company>/logo or projects/<project>/...
  const { results: projectRows } = await env.DB.prepare("SELECT id FROM projects").all<{ id: string }>();
  const keepIds = new Set([...kept.map((k) => k.id), ...projectRows.map((r) => r.id)]);
  const files = await deleteFiles(env, (key) => key.split("/").some((part) => keepIds.has(part)));

  return { tables: tables.length, files, vectors, kept: kept.map((k) => k.name) };
}

export const demoServer = defineServerApp({
  id: "demo",
  name: "Demo",
  async scheduled(env, cron) {
    if (cron !== DEMO_RESET_CRON) return;
    if (((env as DemoEnv).DEMO_RESET || "").trim() !== "true") return;
    const done = await resetDemo(env);
    console.log(`[openact] demo reset: ${done.tables} tables, ${done.files} files, ${done.vectors} vectors, kept: ${done.kept.join(", ") || "none"}`);
  }
});
