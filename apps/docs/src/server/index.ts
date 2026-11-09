import { DAILY_CRON, HttpError, defineServerApp, deletePrefix, nowIso, registerRoomKind, type Env } from "@openact/core/server";
import { DOC_ROOM, LIBRARY_ROOM, aiEnabled, docsRoutes } from "./routes";
import { shareImage, sharePage } from "./share";

/*
 * The Docs app: a company library of paper-size documents, in folders, with categories and tags.
 * A doc can have a share link that needs no account, and anyone can print it or save it as a PDF.
 * A company owner or admin turns Docs on or off in Company settings. A super admin turns it off for the whole site in Site settings.
 */

async function revisions(env: Env, sql: string, ids: string[]): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(sql.replace("?", ids.map(() => "?").join(", ")))
    .bind(...ids)
    .all<{ id: string; rev: number }>();
  // An item that is gone reports rev 0, so open pages load it again and see that it is gone.
  const revs = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const r of rows.results) revs.set(r.id, r.rev);
  return revs;
}

registerRoomKind(DOC_ROOM, (env, ids) => revisions(env, "SELECT id, rev FROM docs_docs WHERE id IN (?)", ids));
registerRoomKind(LIBRARY_ROOM, (env, ids) => revisions(env, "SELECT company_id AS id, rev FROM docs_library WHERE company_id IN (?)", ids));

/** Deletes images whose doc no longer exists, in case a delete stopped half way. */
async function cleanOrphanFiles(env: Env): Promise<void> {
  for (let round = 0; round < 5; round++) {
    const rows = await env.DB.prepare("SELECT f.id, f.r2_key FROM docs_files f LEFT JOIN docs_docs d ON d.id = f.doc_id WHERE d.id IS NULL LIMIT 200").all<{
      id: string;
      r2_key: string;
    }>();
    if (!rows.results.length) return;
    await env.FILES.delete(rows.results.map((r) => r.r2_key));
    await env.DB.prepare(`DELETE FROM docs_files WHERE id IN (${rows.results.map(() => "?").join(", ")})`)
      .bind(...rows.results.map((r) => r.id))
      .run();
  }
}

export default defineServerApp({
  id: "docs",
  name: "Docs",
  permissions: {
    "docs.view": {
      label: "See docs",
      description: "Open and print every doc in the company library.",
      roles: ["owner", "admin", "member"],
      locked: ["owner", "admin"]
    },
    "docs.edit": {
      label: "Write docs",
      description: "Make, change and delete docs, add images, put docs in folders and categories, and tag them.",
      roles: ["owner", "admin", "member"]
    },
    "docs.organize": {
      label: "Organize the library",
      description: "Make, rename, move and delete folders and categories, and rename or delete tags.",
      roles: ["owner", "admin"]
    },
    "docs.share": {
      label: "Share docs with a link",
      description: "Make a link that anyone can open without signing in, or turn it off.",
      roles: ["owner", "admin", "member"]
    },
    "docs.ai": {
      label: "Use AI writing help",
      description: "Send selected doc text to the company's AI to improve, shorten, translate or continue it. A company owner or admin must turn AI on first.",
      roles: ["owner", "admin", "member"]
    }
  },
  routes: (app) => {
    app.route("/api/apps/docs", docsRoutes);
    // Public. wrangler.jsonc sends /docs/s/* to the Worker first (run_worker_first).
    app.get("/docs/s/:token", sharePage);
    app.get("/docs/s/:token/files/:fileId", shareImage);
  },
  scheduled: async (env, cron) => {
    if (cron === DAILY_CRON) await cleanOrphanFiles(env);
  },
  hooks: {
    // Company settings, on the Docs tab.
    companyDetail: async (env, companyId) => ({ docsAi: await aiEnabled(env, companyId) }),
    companyUpdate: async (env, companyId, body) => {
      if (body.docsAi === undefined) return false;
      if (typeof body.docsAi !== "boolean") throw new HttpError(400, "AI writing help must be on or off.");
      await env.DB.prepare(
        "INSERT INTO docs_settings (company_id, ai_enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT (company_id) DO UPDATE SET ai_enabled = excluded.ai_enabled, updated_at = excluded.updated_at"
      )
        .bind(companyId, body.docsAi ? 1 : 0, nowIso())
        .run();
      return true;
    },
    companyDeleting: async (env, companyId) => {
      await deletePrefix(env.FILES, `docs/${companyId}/`);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM docs_files WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM docs_docs WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM docs_folders WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM docs_categories WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM docs_tags WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM docs_library WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM docs_settings WHERE company_id = ?").bind(companyId)
      ]);
    }
  }
});
