import type { Case } from "../harness/cases.ts";
import type { Side } from "../harness/companies.ts";
import type { Deploy } from "../harness/deploy.ts";

/*
 * The Library app. Its content belongs to the site, not to a company: super admins manage it, and every company reads it.
 * So a Beta person may read site content through Beta's own company, but not through Alpha's company,
 * and Beta's owner (who is not a super admin) can never write it. The snapshot proves the site content did not change.
 * The webhook needs its key, not a session. A wrong key must change nothing.
 */

const installed = (d: Deploy) => d.app.routes.some((r) => r.path === "/api/apps/library/companies/:id/config");

const TERM = "00000000-0000-4000-8000-0000000000a1";
const RES = "00000000-0000-4000-8000-0000000000b1";
const DRAFT = "00000000-0000-4000-8000-0000000000b2";
const AUTO = "00000000-0000-4000-8000-0000000000c1";

export async function seed(d: Deploy): Promise<void> {
  if (!installed(d)) return;
  const now = new Date().toISOString();
  d.db.prepare("INSERT INTO library_terms (id, kind, name, sort_order, is_hidden, created_at, updated_at) VALUES (?, 'topic', 'Site topic', 0, 0, ?, ?)").run(TERM, now, now);
  d.db
    .prepare(
      `INSERT INTO library_resources (id, format, title, summary, source_url, status, published_at, created_at, updated_at)
       VALUES (?, 'link', 'Site resource', 'A site summary', 'https://example.com/a', 'published', ?, ?, ?)`
    )
    .run(RES, now, now, now);
  d.db
    .prepare(
      `INSERT INTO library_resources (id, format, title, summary, source_url, status, origin, created_at, updated_at)
       VALUES (?, 'link', 'ALPHASECRET draft', 'Not published', 'https://example.com/b', 'draft', 'feed', ?, ?)`
    )
    .run(DRAFT, now, now);
  d.db.prepare("INSERT INTO library_resource_terms (resource_id, term_id) VALUES (?, ?)").run(RES, TERM);
  d.db.prepare("INSERT INTO library_chunks (resource_id, seq, text) VALUES (?, 0, 'A site summary')").run(RES);
  d.db
    .prepare(
      `INSERT INTO library_automations (id, kind, name, url, feed_url, key_hash, key_last4, created_at, updated_at)
       VALUES (?, 'webhook', 'Site hook', '', '', 'not-a-real-hash', 'abcd', ?, ?)`
    )
    .run(AUTO, now, now);
}

export function snapshot(d: Deploy, _alpha: Side): string {
  if (!installed(d)) return "";
  return JSON.stringify([
    d.all("SELECT * FROM library_terms ORDER BY id"),
    d.all("SELECT id, title, status, summary, source_url FROM library_resources ORDER BY id"),
    d.all("SELECT * FROM library_resource_terms ORDER BY resource_id, term_id"),
    d.all("SELECT id, name, key_hash, is_paused, is_auto_publish FROM library_automations ORDER BY id"),
    d.all("SELECT key, value_json FROM library_settings ORDER BY key")
  ]);
}

const L = "/api/apps/library";
const read = (route: string, path: string): Case[] => [
  { route: `GET ${L}/companies/:id/${route}`, path: (a) => `${L}/companies/${a.companyId}/${path}`, expect: "denied" },
  {
    route: `GET ${L}/companies/:id/${route}`,
    path: (_a, b) => `${L}/companies/${b.companyId}/${path}`,
    expect: "any",
    why: "Site content, read through Beta's own company. It holds no Alpha data, and drafts never show."
  }
];

const upload = () => {
  const f = new FormData();
  f.set("file", new File(["planted"], "planted.txt", { type: "text/plain" }));
  return f;
};

export const cases: Case[] = [
  ...read("config", "config"),
  ...read("resources", "resources"),
  ...read("resources/:rid", `resources/${RES}`),
  ...read("files/:rid", `files/${RES}`),
  ...read("images/:rid", `images/${RES}`),
  { route: `GET ${L}/companies/:id/resources/:rid`, path: (_a, b) => `${L}/companies/${b.companyId}/resources/${DRAFT}`, expect: "denied", why: "A draft is never public." },
  {
    route: `POST ${L}/companies/:id/ask`,
    path: (a) => `${L}/companies/${a.companyId}/ask`,
    body: () => ({ threadId: "t", runId: "r", messages: [{ id: "m", role: "user", content: "Site resource" }] }),
    expect: "denied"
  },

  // The webhook: no session, and a wrong key finds nothing.
  {
    route: `POST ${L}/inbound/:key`,
    path: () => `${L}/inbound/lib_${"x".repeat(32)}`,
    who: "none",
    body: () => ({ url: "https://example.com/planted" }),
    expect: "denied"
  },

  // Manage: super admins only. Beta's owner and member are not super admins.
  { route: `GET ${L}/manage`, path: () => `${L}/manage`, expect: "denied" },
  { route: `GET ${L}/manage/resources`, path: () => `${L}/manage/resources?tab=review`, expect: "denied" },
  { route: `GET ${L}/manage/resources/:rid`, path: () => `${L}/manage/resources/${DRAFT}`, expect: "denied" },
  { route: `GET ${L}/manage/images/:rid`, path: () => `${L}/manage/images/${DRAFT}`, expect: "denied" },
  { route: `GET ${L}/manage/files/:rid`, path: () => `${L}/manage/files/${DRAFT}`, expect: "denied" },
  { route: `POST ${L}/manage/preview`, path: () => `${L}/manage/preview`, body: () => ({ url: "https://example.com/c" }), expect: "denied" },
  {
    route: `POST ${L}/manage/resources`,
    path: () => `${L}/manage/resources`,
    body: () => ({ fields: { format: "link", title: "Planted", sourceUrl: "https://example.com/p" }, publish: true }),
    expect: "denied"
  },
  { route: `POST ${L}/manage/files`, path: () => `${L}/manage/files`, body: upload, expect: "denied" },
  { route: `PUT ${L}/manage/resources/:rid`, path: () => `${L}/manage/resources/${RES}`, body: () => ({ format: "link", title: "Changed" }), expect: "denied" },
  { route: `POST ${L}/manage/resources/:rid/:action`, path: () => `${L}/manage/resources/${DRAFT}/publish`, expect: "denied" },
  { route: `POST ${L}/manage/resources/:rid/:action`, path: () => `${L}/manage/resources/${RES}/archive`, who: "betaMember", expect: "denied" },
  { route: `DELETE ${L}/manage/resources/:rid`, path: () => `${L}/manage/resources/${RES}`, expect: "denied" },
  { route: `PUT ${L}/manage/settings`, path: () => `${L}/manage/settings`, body: () => ({ title: "Taken" }), expect: "denied" },
  { route: `POST ${L}/manage/terms`, path: () => `${L}/manage/terms`, body: () => ({ kind: "topic", name: "Planted" }), expect: "denied" },
  { route: `PATCH ${L}/manage/terms/:termId`, path: () => `${L}/manage/terms/${TERM}`, body: () => ({ name: "Renamed" }), expect: "denied" },
  { route: `GET ${L}/manage/automations`, path: () => `${L}/manage/automations`, expect: "denied" },
  {
    route: `POST ${L}/manage/automations/preview`,
    path: () => `${L}/manage/automations/preview`,
    body: () => ({ kind: "feed", url: "https://example.com/feed.xml" }),
    expect: "denied"
  },
  { route: `POST ${L}/manage/automations`, path: () => `${L}/manage/automations`, body: () => ({ kind: "webhook", name: "Planted" }), expect: "denied" },
  { route: `PATCH ${L}/manage/automations/:aid`, path: () => `${L}/manage/automations/${AUTO}`, body: () => ({ autoPublish: true }), expect: "denied" },
  { route: `POST ${L}/manage/automations/:aid/run`, path: () => `${L}/manage/automations/${AUTO}/run`, expect: "denied" },
  { route: `POST ${L}/manage/automations/:aid/key`, path: () => `${L}/manage/automations/${AUTO}/key`, expect: "denied" },
  { route: `DELETE ${L}/manage/automations/:aid`, path: () => `${L}/manage/automations/${AUTO}`, expect: "denied" }
];
