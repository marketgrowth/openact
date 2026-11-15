import { defineServerApp, type Env } from "@openact/core/server";

/*
 * The nightly reset for the public demo at a.openact.ing. This file lives on the `demo` branch only.
 *
 * When DEMO_RESET is "true", the reset cron deletes all people, companies and app data,
 * and all files except the site logo. It keeps the site settings and the migration history.
 * The table list comes from the database, so new app tables are reset too.
 */

interface DemoEnv extends Env {
  /** "true" turns on the nightly reset. Any other value turns it off. */
  DEMO_RESET?: string;
}

/** 10:17 UTC: about 2 AM Pacific time in winter and 3 AM in summer. It must also be in wrangler.jsonc. */
export const DEMO_RESET_CRON = "17 10 * * *";

const KEEP_TABLES = new Set(["d1_migrations", "site_settings"]);
const KEEP_FILES = new Set(["site/logo"]);

/** Deletes the demo data. Returns what it deleted, for the log. */
export async function resetDemo(env: Env): Promise<{ tables: number; files: number; vectors: number }> {
  // Remove task vectors first, while the task ids still exist. Search checks access on every result, so a miss here is safe.
  let vectors = 0;
  if (env.VECTORS) {
    try {
      const { results } = await env.DB.prepare("SELECT id FROM tasks").all<{ id: string }>();
      const ids = results.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) await env.VECTORS.deleteByIds(ids.slice(i, i + 500));
      vectors = ids.length;
    } catch (e) {
      console.warn("[openact] demo reset: could not delete task vectors", e);
    }
  }

  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
  ).all<{ name: string }>();
  const tables = results.map((r) => r.name).filter((name) => !KEEP_TABLES.has(name));
  // Deferred foreign keys let the deletes run in any order. D1 runs the batch as one transaction.
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
    ...tables.map((name) => env.DB.prepare(`DELETE FROM "${name.replace(/"/g, '""')}"`))
  ]);

  let files = 0;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key).filter((key) => !KEEP_FILES.has(key));
    if (keys.length) await env.FILES.delete(keys);
    files += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { tables: tables.length, files, vectors };
}

export const demoServer = defineServerApp({
  id: "demo",
  name: "Demo",
  async scheduled(env, cron) {
    if (cron !== DEMO_RESET_CRON) return;
    if (((env as DemoEnv).DEMO_RESET || "").trim() !== "true") return;
    const done = await resetDemo(env);
    console.log(`[openact] demo reset: ${done.tables} tables, ${done.files} files, ${done.vectors} vectors`);
  }
});
