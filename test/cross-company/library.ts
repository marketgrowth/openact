import type { Case } from "../harness/cases.ts";
import type { Side } from "../harness/companies.ts";
import type { Deploy } from "../harness/deploy.ts";

/*
 * The Library app at three levels.
 * - The Content Vault (company_id NULL): only super admins read or write it. No company route ever shows it.
 * - Each company library: its owner manages it (library.manage), its members read it.
 * - My Library: a person's bookmarks and private items, inside one company.
 * Beta's people must never read, change or bookmark Alpha's library, the vault, or Alpha people's private items.
 * The vault rows carry the mark too, so a vault leak through Beta's company fails the test.
 * The webhook needs its key, not a session. A wrong key must change nothing.
 */

const installed = (d: Deploy) => d.app.routes.some((r) => r.path === "/api/apps/library/companies/:id/config");

const TERM = "00000000-0000-4000-8000-0000000000a1";
const ATERM = "00000000-0000-4000-8000-0000000000a2";
const VRES = "00000000-0000-4000-8000-0000000000b1";
const DRAFT = "00000000-0000-4000-8000-0000000000b2";
const ARES = "00000000-0000-4000-8000-0000000000b3";
const ADRAFT = "00000000-0000-4000-8000-0000000000b4";
const APERS = "00000000-0000-4000-8000-0000000000b5";
const AUTO = "00000000-0000-4000-8000-0000000000c1";

export async function seed(d: Deploy, alpha: Side): Promise<void> {
  if (!installed(d)) return;
  const now = new Date().toISOString();
  const term = d.db.prepare("INSERT INTO library_terms (id, kind, name, sort_order, is_hidden, company_id, created_at, updated_at) VALUES (?, 'topic', ?, 0, 0, ?, ?, ?)");
  term.run(TERM, "Site topic", null, now, now); // No mark: each new company copies the site lists.
  term.run(ATERM, "ALPHASECRET company topic", alpha.companyId, now, now);
  const res = d.db.prepare(
    `INSERT INTO library_resources (id, format, title, summary, source_url, status, origin, published_at, scope, company_id, owner_user_id, file_key, file_name, file_type, file_size, created_at, updated_at)
     VALUES (?, 'link', ?, 'ALPHASECRET summary', ?, ?, 'person', ?, ?, ?, ?, ?, 'a.txt', 'text/plain', 7, ?, ?)`
  );
  const put = async (id: string, title: string, status: string, scope: string, company: string | null, owner: string | null) => {
    const key = `library/${company ?? "vault"}/${id}/a.txt`;
    await (d.env as unknown as { FILES: { put(k: string, v: string): Promise<unknown> } }).FILES.put(key, "ALPHASECRET file");
    res.run(id, title, `https://example.com/${id}`, status, status === "published" ? now : null, scope, company, owner, key, now, now);
    d.db.prepare("INSERT INTO library_chunks (resource_id, seq, text) VALUES (?, 0, ?)").run(id, `${title} ALPHASECRET text`);
  };
  await put(VRES, "ALPHASECRET vault template", "published", "vault", null, null);
  await put(DRAFT, "ALPHASECRET vault draft", "draft", "vault", null, null);
  await put(ARES, "ALPHASECRET company resource", "published", "company", alpha.companyId, null);
  await put(ADRAFT, "ALPHASECRET company draft", "draft", "company", alpha.companyId, null);
  await put(APERS, "ALPHASECRET private note", "published", "personal", alpha.companyId, alpha.member.id);
  d.db.prepare("INSERT INTO library_resource_terms (resource_id, term_id) VALUES (?, ?)").run(VRES, TERM);
  d.db.prepare("INSERT INTO library_resource_terms (resource_id, term_id) VALUES (?, ?)").run(ARES, ATERM);
  d.db.prepare("INSERT INTO library_bookmarks (company_id, user_id, resource_id, created_at) VALUES (?, ?, ?, ?)").run(alpha.companyId, alpha.member.id, ARES, now);
  d.db.prepare("INSERT INTO library_company_settings (company_id, key, value_json, updated_at) VALUES (?, 'title', ?, ?)").run(alpha.companyId, JSON.stringify("ALPHASECRET library"), now);
  d.db.prepare("INSERT INTO library_company_settings (company_id, key, value_json, updated_at) VALUES (?, '_terms_seeded', 'true', ?)").run(alpha.companyId, now);
  d.db
    .prepare(
      `INSERT INTO library_automations (id, kind, name, url, feed_url, key_hash, key_last4, created_at, updated_at)
       VALUES (?, 'webhook', 'Site hook', '', '', 'not-a-real-hash', 'abcd', ?, ?)`
    )
    .run(AUTO, now, now);
}

export function snapshot(d: Deploy, alpha: Side): string {
  if (!installed(d)) return "";
  const ids = [VRES, DRAFT, ARES, ADRAFT, APERS];
  return JSON.stringify([
    d.all("SELECT * FROM library_terms WHERE company_id IS NULL OR company_id = ? ORDER BY id", alpha.companyId),
    d.all(`SELECT id, title, status, summary, source_url, scope, company_id, owner_user_id, is_featured FROM library_resources WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ...ids),
    d.all("SELECT COUNT(*) AS n FROM library_resources WHERE company_id IS NULL OR company_id = ?", alpha.companyId),
    d.all("SELECT * FROM library_resource_terms ORDER BY resource_id, term_id"),
    d.all("SELECT * FROM library_bookmarks WHERE company_id = ? OR resource_id IN (?, ?, ?) ORDER BY user_id, resource_id", alpha.companyId, ARES, APERS, VRES),
    d.all("SELECT company_id, key, value_json FROM library_company_settings WHERE company_id = ? ORDER BY key", alpha.companyId),
    d.all("SELECT id, name, key_hash, is_paused, is_auto_publish FROM library_automations ORDER BY id"),
    d.all("SELECT key, value_json FROM library_settings ORDER BY key")
  ]);
}

const L = "/api/apps/library";
const A = (a: Side) => `${L}/companies/${a.companyId}`;
const B = (_a: Side, b: Side) => `${L}/companies/${b.companyId}`;

const upload = () => {
  const f = new FormData();
  f.set("file", new File(["planted"], "planted.txt", { type: "text/plain" }));
  return f;
};

const fields = { format: "link", title: "Planted", sourceUrl: "https://example.com/planted" };

/** A read route: denied through Alpha's company; through Beta's company it may answer, with no Alpha or vault data. */
const read = (route: string, path: string, why = "Beta's own company. It must not hold Alpha data or vault templates."): Case[] => [
  { route: `GET ${L}/companies/:id/${route}`, path: (a) => `${A(a)}/${path}`, expect: "denied" },
  { route: `GET ${L}/companies/:id/${route}`, path: (a, b) => `${B(a, b)}/${path}`, expect: "any", why }
];

/** An item route: Alpha's ids through Beta's company are not found, and Alpha's company is closed. */
const item = (method: string, route: string, tail: string, body?: () => unknown, who?: "betaMember"): Case[] => [
  { route: `${method} ${L}/companies/:id/${route}`, path: (a) => `${A(a)}/${tail.replace(":rid", ARES)}`, body, who, expect: "denied" },
  ...[ARES, ADRAFT, APERS, VRES, DRAFT].map((rid) => ({
    route: `${method} ${L}/companies/:id/${route}`,
    path: (a: Side, b: Side) => `${B(a, b)}/${tail.replace(":rid", rid)}`,
    body,
    who,
    expect: "denied" as const
  }))
];

export const cases: Case[] = [
  // Reading.
  ...read("config", "config"),
  ...read("resources", "resources"),
  ...read("resources", "resources?q=ALPHASECRET", "Search in Beta's own company finds nothing of Alpha's or of the vault."),
  ...item("GET", "resources/:rid", "resources/:rid"),
  ...item("GET", "files/:rid", "files/:rid"),
  ...item("GET", "images/:rid", "images/:rid"),
  { route: `POST ${L}/companies/:id/ask`, path: A, body: () => ({ threadId: "t", runId: "r", messages: [{ id: "m", role: "user", content: "company resource" }] }), expect: "denied" },
  {
    route: `POST ${L}/companies/:id/ask`,
    path: B,
    body: () => ({ threadId: "t", runId: "r", messages: [{ id: "m", role: "user", content: "company resource private note vault template" }] }),
    expect: "any",
    why: "Ask in Beta's own company reads only Beta's library and the caller's own items."
  },

  // My Library.
  ...read("mine", "mine", "Beta's own My Library. Alpha bookmarks and private items never show."),
  ...item("PUT", "bookmarks/:rid", "bookmarks/:rid"),
  { route: `DELETE ${L}/companies/:id/bookmarks/:rid`, path: (a) => `${A(a)}/bookmarks/${ARES}`, expect: "denied" },
  { route: `DELETE ${L}/companies/:id/bookmarks/:rid`, path: (a, b) => `${B(a, b)}/bookmarks/${ARES}`, expect: "any", why: "Removes only the caller's own bookmark. The snapshot proves Alpha's bookmark stays." },
  { route: `POST ${L}/companies/:id/mine/preview`, path: (a) => `${A(a)}/mine/preview`, body: () => ({ url: "https://example.com/c" }), expect: "denied" },
  { route: `POST ${L}/companies/:id/mine`, path: (a) => `${A(a)}/mine`, body: () => ({ fields }), expect: "denied" },
  { route: `POST ${L}/companies/:id/mine/files`, path: (a) => `${A(a)}/mine/files`, body: upload, expect: "denied" },
  ...item("PUT", "mine/:rid", "mine/:rid", () => fields),
  ...item("DELETE", "mine/:rid", "mine/:rid"),

  // Manage Company: the company owner only. Alpha's company is closed; Beta's member is not an owner.
  { route: `GET ${L}/companies/:id/manage`, path: (a) => `${A(a)}/manage`, expect: "denied" },
  { route: `GET ${L}/companies/:id/manage`, path: (a, b) => `${B(a, b)}/manage`, who: "betaMember", expect: "denied" },
  { route: `GET ${L}/companies/:id/manage`, path: (a, b) => `${B(a, b)}/manage`, expect: "any", why: "Beta's owner manages Beta's library. It holds no Alpha data." },
  { route: `GET ${L}/companies/:id/manage/resources`, path: (a) => `${A(a)}/manage/resources?tab=drafts`, expect: "denied" },
  { route: `GET ${L}/companies/:id/manage/resources`, path: (a, b) => `${B(a, b)}/manage/resources?tab=drafts`, expect: "any", why: "Beta's own drafts. Alpha drafts and vault drafts never show." },
  ...item("GET", "manage/resources/:rid", "manage/resources/:rid"),
  ...item("GET", "manage/files/:rid", "manage/files/:rid"),
  ...item("GET", "manage/images/:rid", "manage/images/:rid"),
  { route: `POST ${L}/companies/:id/manage/preview`, path: (a) => `${A(a)}/manage/preview`, body: () => ({ url: "https://example.com/c" }), expect: "denied" },
  { route: `POST ${L}/companies/:id/manage/resources`, path: (a) => `${A(a)}/manage/resources`, body: () => ({ fields, publish: true }), expect: "denied" },
  { route: `POST ${L}/companies/:id/manage/resources`, path: (a, b) => `${B(a, b)}/manage/resources`, who: "betaMember", body: () => ({ fields, publish: true }), expect: "denied" },
  { route: `POST ${L}/companies/:id/manage/files`, path: (a) => `${A(a)}/manage/files`, body: upload, expect: "denied" },
  ...item("PUT", "manage/resources/:rid", "manage/resources/:rid", () => fields),
  ...item("POST", "manage/resources/:rid/:action", "manage/resources/:rid/archive"),
  ...item("DELETE", "manage/resources/:rid", "manage/resources/:rid"),
  { route: `PUT ${L}/companies/:id/manage/settings`, path: (a) => `${A(a)}/manage/settings`, body: () => ({ title: "Taken" }), expect: "denied" },
  { route: `PUT ${L}/companies/:id/manage/settings`, path: (a, b) => `${B(a, b)}/manage/settings`, who: "betaMember", body: () => ({ title: "Taken" }), expect: "denied" },
  { route: `POST ${L}/companies/:id/manage/terms`, path: (a) => `${A(a)}/manage/terms`, body: () => ({ kind: "topic", name: "Planted" }), expect: "denied" },
  { route: `PATCH ${L}/companies/:id/manage/terms/:termId`, path: (a) => `${A(a)}/manage/terms/${ATERM}`, body: () => ({ name: "Renamed" }), expect: "denied" },
  { route: `PATCH ${L}/companies/:id/manage/terms/:termId`, path: (a, b) => `${B(a, b)}/manage/terms/${ATERM}`, body: () => ({ name: "Renamed" }), expect: "denied" },
  { route: `PATCH ${L}/companies/:id/manage/terms/:termId`, path: (a, b) => `${B(a, b)}/manage/terms/${TERM}`, body: () => ({ name: "Renamed" }), expect: "denied", why: "A site list value is not Beta's to change." },

  // The webhook: no session, and a wrong key finds nothing.
  {
    route: `POST ${L}/inbound/:key`,
    path: () => `${L}/inbound/lib_${"x".repeat(32)}`,
    who: "none",
    body: () => ({ url: "https://example.com/planted" }),
    expect: "denied"
  },

  // Manage Site Library (the vault): super admins only. Beta's owner and member are not super admins.
  // (old line follows) Beta's owner and member are not super admins.
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
  { route: `PUT ${L}/manage/resources/:rid`, path: () => `${L}/manage/resources/${VRES}`, body: () => ({ format: "link", title: "Changed" }), expect: "denied" },
  { route: `POST ${L}/manage/resources/:rid/:action`, path: () => `${L}/manage/resources/${DRAFT}/publish`, expect: "denied" },
  { route: `POST ${L}/manage/resources/:rid/:action`, path: () => `${L}/manage/resources/${VRES}/archive`, who: "betaMember", expect: "denied" },
  { route: `DELETE ${L}/manage/resources/:rid`, path: () => `${L}/manage/resources/${VRES}`, expect: "denied" },
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
