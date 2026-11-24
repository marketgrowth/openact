import type { Case } from "../harness/cases.ts";
import type { Side } from "../harness/companies.ts";
import type { Deploy } from "../harness/deploy.ts";

/*
 * The Library app. Its content belongs to the site, not to a company: super admins write it, and every company reads it.
 * So a Beta person may read site content through Beta's own company, but not through Alpha's company,
 * and Beta's owner (who is not a super admin) can never write it. The snapshot proves the site content did not change.
 * Part 1 has no company rows. Part 2 adds per-person markers and tasks, with Alpha data in the seed.
 */

const installed = (d: Deploy) => d.app.routes.some((r) => r.path === "/api/apps/library/companies/:id/config");

const TERM = "00000000-0000-4000-8000-0000000000a1";
const SOURCE = "00000000-0000-4000-8000-0000000000b1";
const UPDATE = "00000000-0000-4000-8000-0000000000c1";

export async function seed(d: Deploy): Promise<void> {
  if (!installed(d)) return;
  const now = new Date().toISOString();
  d.db.prepare("INSERT INTO library_terms (id, kind, name, sort_order, is_hidden, created_at, updated_at) VALUES (?, 'audience', 'Site audience', 0, 0, ?, ?)").run(TERM, now, now);
  d.db.prepare("INSERT INTO library_sources (id, title, summary, source_url, status, created_at, updated_at) VALUES (?, 'Site source', 'A site summary', 'https://example.gov/a', 'published', ?, ?)").run(SOURCE, now, now);
  d.db.prepare("INSERT INTO library_updates (id, title, what_changed, source_url, status, published_date, created_at, updated_at) VALUES (?, 'Site update', 'A change', 'https://example.gov/b', 'published', ?, ?, ?)").run(UPDATE, now.slice(0, 10), now, now);
  const src = { title: "Site source", citation: "", summary: "A site summary", details: "", sourceUrl: "https://example.gov/a", lastCheckedDate: null, termIds: [TERM] };
  const upd = { title: "Site update", whatChanged: "A change", whoAffected: "", action: "", actionDueDate: null, sourceUrl: "https://example.gov/b", publishedDate: now.slice(0, 10), termIds: [TERM], sourceIds: [SOURCE] };
  d.db.prepare("INSERT INTO library_versions (item_kind, item_id, version, snapshot_json, published_at) VALUES ('source', ?, 1, ?, ?)").run(SOURCE, JSON.stringify(src), now);
  d.db.prepare("INSERT INTO library_versions (item_kind, item_id, version, snapshot_json, published_at) VALUES ('update', ?, 1, ?, ?)").run(UPDATE, JSON.stringify(upd), now);
}

export function snapshot(d: Deploy, _alpha: Side): string {
  if (!installed(d)) return "";
  return JSON.stringify([
    d.all("SELECT * FROM library_terms ORDER BY id"),
    d.all("SELECT id, title, status, review_note FROM library_sources ORDER BY id"),
    d.all("SELECT id, title, status, review_note FROM library_updates ORDER BY id"),
    d.all("SELECT item_kind, item_id, version FROM library_versions ORDER BY item_kind, item_id, version"),
    d.all("SELECT key, value_json FROM library_settings ORDER BY key")
  ]);
}

const L = "/api/apps/library";
const read = (path: string): Case[] => [
  { route: `GET ${L}/companies/:id/${path.replace(SOURCE, ":itemId").replace(UPDATE, ":itemId")}`, path: (a) => `${L}/companies/${a.companyId}/${path}`, expect: "denied" },
  {
    route: `GET ${L}/companies/:id/${path.replace(SOURCE, ":itemId").replace(UPDATE, ":itemId")}`,
    path: (_a, b) => `${L}/companies/${b.companyId}/${path}`,
    expect: "any",
    why: "Site content, read through Beta's own company. It holds no Alpha data."
  }
];

export const cases: Case[] = [
  ...read("config"),
  ...read("sources"),
  ...read("updates"),
  ...read(`sources/${SOURCE}`),
  ...read(`updates/${UPDATE}`),
  { route: `POST ${L}/companies/:id/ask`, path: (a) => `${L}/companies/${a.companyId}/ask`, body: () => ({ question: "Site source" }), expect: "denied" },

  // Writes and working copies: super admins only. Beta's owner and member are not super admins.
  { route: `GET ${L}/manage`, path: () => `${L}/manage`, expect: "denied" },
  { route: `PUT ${L}/manage/settings`, path: () => `${L}/manage/settings`, body: () => ({ title: "Taken" }), expect: "denied" },
  { route: `POST ${L}/manage/terms`, path: () => `${L}/manage/terms`, body: () => ({ kind: "topic", name: "Planted" }), expect: "denied" },
  { route: `PATCH ${L}/manage/terms/:termId`, path: () => `${L}/manage/terms/${TERM}`, body: () => ({ name: "Renamed" }), expect: "denied" },
  { route: `POST ${L}/manage/items/:kind`, path: () => `${L}/manage/items/sources`, body: () => ({ title: "Planted" }), expect: "denied" },
  { route: `GET ${L}/manage/items/:kind/:itemId`, path: () => `${L}/manage/items/sources/${SOURCE}`, expect: "denied" },
  { route: `PUT ${L}/manage/items/:kind/:itemId`, path: () => `${L}/manage/items/updates/${UPDATE}`, body: () => ({ title: "Changed" }), expect: "denied" },
  { route: `POST ${L}/manage/items/:kind/:itemId/:action`, path: () => `${L}/manage/items/sources/${SOURCE}/archive`, expect: "denied" },
  {
    route: `POST ${L}/manage/items/:kind/:itemId/:action`,
    path: () => `${L}/manage/items/updates/${UPDATE}/publish`,
    who: "betaMember",
    body: () => ({ checks: [true, true] }),
    expect: "denied"
  }
];
