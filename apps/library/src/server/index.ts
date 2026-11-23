import { Hono, type Context } from "hono";
import {
  HttpError,
  dateOrNull,
  defineServerApp,
  isSuperAdmin,
  oneOf,
  readJson,
  requirePermission,
  requireSuperAdmin,
  requireUser,
  text,
  todayIso,
  type AppEnv,
  type Env
} from "@openact/core/server";
import {
  API,
  KIND_PATH,
  MAX_SHORT,
  REVIEW_ACTIONS,
  TERM_KINDS,
  kindFromPath,
  newSince,
  type ItemKind,
  type LibraryConfig,
  type ManageState,
  type Settings,
  type SourceDetail,
  type Term,
  type TermKind,
  type UpdateDetail
} from "../shared/rules.ts";
import type { LibraryContentService } from "./service.ts";
import { cleanFields, cleanSettings } from "./validate.ts";
import {
  addTerm,
  archiveItem,
  changeTerm,
  createItem,
  listAllTerms,
  loadSettings,
  manageItem,
  manageRows,
  publishItem,
  publishedSources,
  publishedUpdates,
  restoreItem,
  returnItem,
  saveItem,
  saveSettings,
  submitItem,
  type Filter
} from "./store.ts";

/*
 * The Library app: one body of reference content for the whole site.
 * The site owns the content. Only super admins write it (requireSuperAdmin). Every company with the app on reads it (library.view).
 * Readers get published copies only. Working copies, review notes and history stay on the /manage routes.
 */

/** Terms that readers may see: the lists that are on. Hidden items stay, so their tags still show on items. */
const readerTerms = (terms: Term[], s: Settings) => terms.filter((t) => s.lists[t.kind].on);

/** Filters from the query string: q, and category, audience, topic as comma-separated ids. Lists that are off do not filter. */
function filterFrom(c: Context<AppEnv>, s: Settings): Filter {
  const q = (c.req.query("q") ?? "").slice(0, MAX_SHORT);
  const terms: Partial<Record<TermKind, string[]>> = {};
  for (const k of TERM_KINDS) {
    if (!s.lists[k].on) continue;
    const v = c.req.query(k);
    if (v) terms[k] = v.split(",").filter(Boolean).slice(0, 60);
  }
  return { q, terms };
}

const kindOr404 = (c: Context<AppEnv>): ItemKind => {
  const k = kindFromPath(c.req.param("kind"));
  if (!k) throw new HttpError(404, "Not found.");
  return k;
};

const routes = new Hono<AppEnv>();

/* Readers: a person in a company where the app is on, with library.view. */

async function reader(c: Context<AppEnv>) {
  const user = requireUser(c);
  await requirePermission(c.env, c.req.param("id")!, user.id, "library.view");
  return user;
}

routes.get("/companies/:id/config", async (c) => {
  const user = await reader(c);
  const settings = await loadSettings(c.env);
  const since = newSince(todayIso(), settings.newDays);
  const updates = await publishedUpdates(c.env, settings);
  const out: LibraryConfig = {
    settings,
    terms: readerTerms(await listAllTerms(c.env), settings),
    canManage: isSuperAdmin(c.env, user),
    newCount: updates.filter((u) => !!u.publishedDate && u.publishedDate >= since).length
  };
  return c.json(out);
});

routes.get("/companies/:id/sources", async (c) => {
  await reader(c);
  const settings = await loadSettings(c.env);
  return c.json({ items: await publishedSources(c.env, settings, filterFrom(c, settings)) });
});

routes.get("/companies/:id/updates", async (c) => {
  await reader(c);
  const settings = await loadSettings(c.env);
  return c.json({ items: await publishedUpdates(c.env, settings, filterFrom(c, settings)) });
});

routes.get("/companies/:id/sources/:itemId", async (c) => {
  await reader(c);
  const settings = await loadSettings(c.env);
  const one = (await publishedSources(c.env, settings)).find((s) => s.id === c.req.param("itemId"));
  if (!one) throw new HttpError(404, "That source is not in the library.");
  const updates = (await publishedUpdates(c.env, settings))
    .filter((u) => u.sourceIds.includes(one.id))
    .map((u) => ({ id: u.id, title: u.title, publishedDate: u.publishedDate }));
  const out: SourceDetail = { item: one, updates };
  return c.json(out);
});

routes.get("/companies/:id/updates/:itemId", async (c) => {
  await reader(c);
  const settings = await loadSettings(c.env);
  const one = (await publishedUpdates(c.env, settings)).find((u) => u.id === c.req.param("itemId"));
  if (!one) throw new HttpError(404, "That update is not in the library.");
  const live = new Map((await publishedSources(c.env, settings)).map((s) => [s.id, s.title]));
  const out: UpdateDetail = { item: one, sources: one.sourceIds.filter((id) => live.has(id)).map((id) => ({ id, title: live.get(id)! })) };
  return c.json(out);
});

/* Super admins: the working copies, the lists and the settings. */

async function manageState(env: Env): Promise<ManageState> {
  return { rows: await manageRows(env), settings: await loadSettings(env), terms: await listAllTerms(env) };
}

routes.get("/manage", async (c) => {
  requireSuperAdmin(c);
  return c.json(await manageState(c.env));
});

routes.put("/manage/settings", async (c) => {
  const user = requireSuperAdmin(c);
  const next = cleanSettings(await readJson(c), await loadSettings(c.env));
  await saveSettings(c.env, next, user.id);
  return c.json(await manageState(c.env));
});

routes.post("/manage/terms", async (c) => {
  requireSuperAdmin(c);
  const b = await readJson(c);
  const term = await addTerm(c.env, oneOf(b.kind, "List", TERM_KINDS), b.name);
  return c.json({ term }, 201);
});

routes.patch("/manage/terms/:termId", async (c) => {
  requireSuperAdmin(c);
  await changeTerm(c.env, c.req.param("termId"), await readJson(c));
  return c.json({ terms: await listAllTerms(c.env) });
});

routes.post("/manage/items/:kind", async (c) => {
  const user = requireSuperAdmin(c);
  const kind = kindOr404(c);
  const id = await createItem(c.env, kind, cleanFields(kind, await readJson(c)), user.id);
  return c.json(await manageItem(c.env, kind, id, await loadSettings(c.env), user.id), 201);
});

routes.get("/manage/items/:kind/:itemId", async (c) => {
  const user = requireSuperAdmin(c);
  const kind = kindOr404(c);
  return c.json(await manageItem(c.env, kind, c.req.param("itemId"), await loadSettings(c.env), user.id));
});

routes.put("/manage/items/:kind/:itemId", async (c) => {
  const user = requireSuperAdmin(c);
  const kind = kindOr404(c);
  const id = c.req.param("itemId");
  await saveItem(c.env, kind, id, cleanFields(kind, await readJson(c)), user.id);
  return c.json(await manageItem(c.env, kind, id, await loadSettings(c.env), user.id));
});

routes.post("/manage/items/:kind/:itemId/:action", async (c) => {
  const user = requireSuperAdmin(c);
  const kind = kindOr404(c);
  const id = c.req.param("itemId");
  const action = oneOf(c.req.param("action"), "Action", REVIEW_ACTIONS);
  const settings = await loadSettings(c.env);
  const b = action === "return" || action === "publish" ? await readJson(c) : {};
  if (action === "submit") await submitItem(c.env, kind, id, user.id);
  else if (action === "return") await returnItem(c.env, kind, id, text(b.note, "Note", { max: MAX_SHORT }));
  else if (action === "publish") await publishItem(c.env, kind, id, settings, user.id, { checks: b.checks, publishedDate: dateOrNull(b.publishedDate, "Published date") });
  else if (action === "archive") await archiveItem(c.env, kind, id);
  else await restoreItem(c.env, kind, id);
  return c.json(await manageItem(c.env, kind, id, settings, user.id));
});

/* The service for other apps. It returns published content only and checks no access: the caller checks its own. */

const content: LibraryContentService = {
  async listTerms(env, kind) {
    const s = await loadSettings(env);
    if (!s.lists[kind].on) return [];
    return (await listAllTerms(env)).filter((t) => t.kind === kind && !t.isHidden);
  },
  async listUpdates(env, opts = {}) {
    const s = await loadSettings(env);
    let items = await publishedUpdates(env, s, { q: opts.q, terms: { category: opts.categoryIds, audience: opts.audienceIds, topic: opts.topicIds } });
    if (opts.since) items = items.filter((u) => !!u.publishedDate && u.publishedDate >= opts.since!);
    return items.slice(0, opts.limit ?? 50);
  },
  async listSources(env, opts = {}) {
    const s = await loadSettings(env);
    const items = await publishedSources(env, s, { q: opts.q, terms: { category: opts.categoryIds, audience: opts.audienceIds, topic: opts.topicIds } });
    return items.slice(0, opts.limit ?? 50);
  },
  async getUpdate(env, id) {
    return (await publishedUpdates(env, await loadSettings(env))).find((u) => u.id === id) ?? null;
  },
  async getSource(env, id) {
    return (await publishedSources(env, await loadSettings(env))).find((s) => s.id === id) ?? null;
  },
  itemPath: (kind, id) => `/a/library/${KIND_PATH[kind]}/${encodeURIComponent(id)}`
};

export default defineServerApp({
  id: "library",
  name: "Library",
  permissions: {
    "library.view": {
      label: "Read the library",
      description: "Read the sources and updates that the site owner publishes.",
      roles: ["owner", "admin", "member"],
      locked: ["owner"]
    }
  },
  services: { content },
  routes: (api) => api.route(API, routes)
  // No company rows in part 1, so no cleanup hooks. Part 2 adds per-person "seen" markers and tasks, with companyMemberRemoved and companyDeleting.
});
