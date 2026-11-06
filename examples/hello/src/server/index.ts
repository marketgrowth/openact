import { Hono } from "hono";
import { defineServerApp, newId, nowIso, readJson, requireCompanyRole, requireUser, text, type AppEnv } from "@openact/core/server";

/* The Hello app: short notes that everyone in a company can read. Members and up can add one. */

const routes = new Hono<AppEnv>();

routes.get("/companies/:id/notes", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("id");
  await requireCompanyRole(c.env, companyId, user.id, ["owner", "admin", "member", "guest"]);
  const rows = await c.env.DB.prepare(
    "SELECT n.id, n.body, n.created_at, u.name AS author FROM hello_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.company_id = ? ORDER BY n.created_at DESC LIMIT 50"
  )
    .bind(companyId)
    .all<{ id: string; body: string; created_at: string; author: string | null }>();
  return c.json({ notes: rows.results.map((r) => ({ id: r.id, body: r.body, author: r.author ?? "A former member", createdAt: r.created_at })) });
});

routes.post("/companies/:id/notes", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("id");
  await requireCompanyRole(c.env, companyId, user.id, ["owner", "admin", "member"]);
  const body = text((await readJson(c)).body, "Note", { max: 500, required: true });
  const id = newId();
  await c.env.DB.prepare("INSERT INTO hello_notes (id, company_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, companyId, user.id, body, nowIso())
    .run();
  return c.json({ id }, 201);
});

export default defineServerApp({
  id: "hello",
  name: "Hello",
  routes: (api) => api.route("/api/apps/hello", routes),
  hooks: {
    // Notes stay when their author leaves, but no longer show the author's name.
    companyMemberRemoved: async (env, companyId, userId) => {
      await env.DB.prepare("UPDATE hello_notes SET user_id = NULL WHERE company_id = ? AND user_id = ?").bind(companyId, userId).run();
    }
  }
});
