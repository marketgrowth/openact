import { DAILY_CRON, HttpError, defineServerApp, deletePrefix, nowIso, registerRoomKind, type Env } from "@openact/core/server";
import { API } from "../shared/types.ts";
import { ROOM, docsLibrary, loadSettings } from "./data.ts";
import { routes } from "./routes.ts";
import { publicRoutes } from "./public.ts";
import { finishStuck } from "./finish.ts";

/*
 * The eSign app, part of OpenAct Director.
 * A company makes templates: a PDF with signer roles and fields on its pages. It sends a template
 * to signers by email. Each signer opens a link, needs no account, agrees to sign electronically and signs.
 * When everyone has signed, the Worker builds the signed PDF with a signing certificate, and saves a copy
 * to Docs when Docs is on.
 */

registerRoomKind(ROOM, async (env, ids) => {
  const rows = await env.DB.prepare(`SELECT company_id AS id, rev FROM esign_state WHERE company_id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: string; rev: number }>();
  const revs = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const r of rows.results) revs.set(r.id, r.rev);
  return revs;
});

/** The job that runs every 10 minutes in wrangler.jsonc. */
const TEN_MINUTES = "*/10 * * * *";

export default defineServerApp({
  id: "esign",
  name: "eSign",
  permissions: {
    "esign.send": {
      label: "Send documents for signature",
      description: "Make templates, send documents for signature, and see, remind and void the documents you sent.",
      roles: ["owner", "admin", "member"],
      locked: ["owner", "admin"]
    },
    "esign.manage": {
      label: "Manage all documents",
      description: "See, remind and void every document in the company, change every template, and choose where signed PDFs go.",
      roles: ["owner", "admin"],
      locked: ["owner"]
    }
  },
  routes: (app) => {
    app.route(API, routes);
    app.route(API, publicRoutes);
  },
  scheduled: async (env, cron) => {
    if (cron === TEN_MINUTES || cron === DAILY_CRON) await finishStuck(env);
  },
  hooks: {
    // Company settings, on the eSign tab.
    companyDetail: async (env, companyId) => ({ esign: { ...(await loadSettings(env, companyId)), docsOn: !!(await docsLibrary(env, companyId)) } }),
    companyUpdate: async (env, companyId, body) => {
      if (body.esign === undefined) return false;
      const b = body.esign;
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Send the eSign settings as an object.");
      const s = b as Record<string, unknown>;
      const now = await loadSettings(env, companyId);
      if (s.saveToDocs !== undefined && typeof s.saveToDocs !== "boolean") throw new HttpError(400, "Save to Docs must be on or off.");
      let folder = now.docsFolderId;
      if (s.docsFolderId !== undefined) {
        if (s.docsFolderId !== null && typeof s.docsFolderId !== "string") throw new HttpError(400, "Choose a Docs folder, or none.");
        folder = (s.docsFolderId as string | null) || null;
        if (folder) {
          const lib = await docsLibrary(env, companyId);
          const ok = lib && (await lib.folders(env, companyId)).some((f) => f.id === folder);
          if (!ok) throw new HttpError(400, "That Docs folder does not exist. Load the page again.");
        }
      }
      await env.DB.prepare(
        `INSERT INTO esign_settings (company_id, save_to_docs, docs_folder_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (company_id) DO UPDATE SET save_to_docs = excluded.save_to_docs, docs_folder_id = excluded.docs_folder_id, updated_at = excluded.updated_at`
      )
        .bind(companyId, (s.saveToDocs ?? now.saveToDocs) ? 1 : 0, folder, nowIso())
        .run();
      return true;
    },
    // Templates and documents belong to the company. They stay when a person leaves.
    companyDeleting: async (env: Env, companyId: string) => {
      await deletePrefix(env.FILES, `esign/${companyId}/`);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM esign_events WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM esign_submitters WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM esign_submissions WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM esign_templates WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM esign_settings WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM esign_state WHERE company_id = ?").bind(companyId)
      ]);
    }
  }
});
