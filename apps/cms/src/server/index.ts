import { Hono } from "hono";
import { HttpError, defineServerApp, nowIso, requirePermission, requireUser, type AppEnv, type Env } from "@openact/core/server";
import { API, cleanSiteUrl, type CmsSite } from "../shared/rules.ts";

/*
 * The CMS app. It connects a company's EmDash site.
 * A company owner or admin saves the address of the company's EmDash site in Company settings > CMS.
 * The web app then shows the site's admin in a frame, to the right of the app rail.
 * EmDash keeps its own sign-in. OpenAct stores only the address.
 */

async function loadSiteUrl(env: Env, companyId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT site_url FROM cms_settings WHERE company_id = ?").bind(companyId).first<{ site_url: string }>();
  return row?.site_url ?? null;
}

const routes = new Hono<AppEnv>();

/** The site address for the CMS page. */
routes.get("/companies/:id/site", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("id");
  const role = await requirePermission(c.env, companyId, user.id, "cms.use");
  const site: CmsSite = { siteUrl: await loadSiteUrl(c.env, companyId), canManage: role === "owner" || role === "admin" };
  return c.json(site);
});

export default defineServerApp({
  id: "cms",
  name: "CMS",
  permissions: {
    "cms.use": {
      label: "Open the CMS",
      description: "See the CMS page, the EmDash admin, in OpenAct. People still sign in to EmDash with their EmDash account.",
      roles: ["owner", "admin"],
      locked: ["owner"]
    }
  },
  routes: (api) => api.route(API, routes),
  hooks: {
    // Company settings, on the CMS tab. Only owners and admins can save company settings.
    companyDetail: async (env, companyId) => ({ cms: { siteUrl: await loadSiteUrl(env, companyId) } }),
    companyUpdate: async (env, companyId, body) => {
      if (body.cms === undefined) return false;
      const b = body.cms;
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Send the CMS settings as an object.");
      const r = cleanSiteUrl((b as Record<string, unknown>).siteUrl);
      if ("problem" in r) throw new HttpError(400, r.problem);
      if (!r.url) {
        await env.DB.prepare("DELETE FROM cms_settings WHERE company_id = ?").bind(companyId).run();
        return true;
      }
      await env.DB.prepare(
        `INSERT INTO cms_settings (company_id, site_url, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (company_id) DO UPDATE SET site_url = excluded.site_url, updated_at = excluded.updated_at`
      )
        .bind(companyId, r.url, nowIso())
        .run();
      return true;
    },
    // A duplicate company points at the same EmDash site.
    companyDuplicating: async (env, ctx) => {
      const r = await env.DB.prepare(
        "INSERT INTO cms_settings (company_id, site_url, updated_at) SELECT ?, site_url, ? FROM cms_settings WHERE company_id = ?"
      )
        .bind(ctx.toId, ctx.now, ctx.fromId)
        .run();
      return r.meta.changes ? [{ label: "EmDash site address", count: 1 }] : [];
    },
    companyDeleting: async (env, companyId) => {
      await env.DB.prepare("DELETE FROM cms_settings WHERE company_id = ?").bind(companyId).run();
    }
  }
});
