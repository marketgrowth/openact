// Search pipeline test: real migrations in SQLite (node:sqlite), the real Worker search code,
// and fake Vectorize and Workers AI bindings. Run with: npm run test:search
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(mkdtempSync(join(tmpdir(), "openact-search-")), "bundle.mjs");
await build({ stdin: { contents: `export { processVectorOutbox, hybridSearch } from "${join(root, "src/worker/search/index.ts")}";`, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning",
  // Workers-only modules get small stand-ins. The search code does not use them.
  plugins: [{ name: "workers-stubs", setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare-workers", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", loader: "js" }));
  } }]
});
const mod = await import(out);
const results = [];
console.warn = () => {}; // The test triggers failures on purpose.
const check = (name, cond, detail = "") => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : `  -> ${JSON.stringify(detail)}`)); };

// D1 over node:sqlite
const sql = new DatabaseSync(":memory:");
sql.exec("PRAGMA foreign_keys = ON");
for (const f of readdirSync(join(root, "migrations")).sort()) sql.exec(readFileSync(join(root, "migrations", f), "utf8"));
const norm = (v) => (v === undefined ? null : v);
const D1 = {
  prepare(q) {
    const mk = (args) => ({
      bind: (...a) => mk(a.map(norm)),
      all: async () => ({ results: sql.prepare(q).all(...args) }),
      first: async () => sql.prepare(q).get(...args) ?? null,
      run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
      _exec: () => (/^\s*(select|with)|returning/i.test(q) ? { results: sql.prepare(q).all(...args) } : (sql.prepare(q).run(...args), { results: [] }))
    });
    return mk([]);
  },
  batch: async (stmts) => stmts.map((s) => s._exec())
};

// Fake embeddings: words map to concepts, so "hall" and "venue" mean the same thing.
const CONCEPTS = { venue: 1, hall: 1, location: 1, gala: 2, party: 2, event: 2, copy: 3, text: 3, writing: 3, page: 4, website: 4, site: 4, dana: 5, donor: 6, sponsor: 6 };
const embedded = [];
const embed = (t) => { embedded.push(t); const v = new Array(768).fill(0); for (const w of t.toLowerCase().split(/[^a-z]+/)) if (CONCEPTS[w]) v[CONCEPTS[w]] += 1; v[700] = 0.0001; const n = Math.hypot(...v); return v.map((x) => x / n); };
let aiFails = null;
const AI = { run: async (model, input) => { if (aiFails) throw new Error(aiFails); assert.equal(model, "@cf/baai/bge-base-en-v1.5"); return { shape: [input.text.length, 768], data: input.text.map(embed) }; } };
const store = new Map();
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const VECTORS = {
  upsert: async (vs) => { for (const v of vs) store.set(v.id, v); return { mutationId: "m" }; },
  deleteByIds: async (ids) => { for (const id of ids) store.delete(id); return { mutationId: "m" }; },
  getByIds: async (ids) => ids.map((id) => store.get(id)).filter(Boolean),
  query: async (values, o) => {
    let all = [...store.values()].filter((v) => v.namespace === o.namespace);
    if (o.filter?.project_id) all = all.filter((v) => v.metadata.project_id === o.filter.project_id);
    const matches = all.map((v) => ({ id: v.id, score: cos(values, v.values), metadata: v.metadata })).sort((a, b) => b.score - a.score).slice(0, o.topK);
    return { matches, count: matches.length };
  }
};
const env = { DB: D1, AI, VECTORS, AI_GATEWAY_ID: "" };

// Seed: one person, two companies, a secret project, and notes that must not be embedded.
const now = new Date().toISOString();
sql.exec(`INSERT INTO users (id, email, name, created_at) VALUES ('u1','maya@acme.com','Maya','${now}'), ('u2','sam@acme.com','Sam','${now}');
INSERT INTO companies (id, name, created_at, updated_at) VALUES ('c1','Acme','${now}','${now}'), ('c2','Other','${now}','${now}');
INSERT INTO company_members VALUES ('c1','u1','member','${now}'), ('c2','u2','owner','${now}');
INSERT INTO projects (id, name, created_at, updated_at, company_id, visibility, ai_policy) VALUES
 ('p1','Fall fundraiser','${now}','${now}','c1','company','{}'),
 ('p2','Board secrets','${now}','${now}','c1','secret','{}'),
 ('p3','Other co','${now}','${now}','c2','company','{}'),
 ('p4','Notes allowed','${now}','${now}','c1','company','{"readNotes":true}');
INSERT INTO tasks (id, project_id, title, notes, phase, created_at, updated_at) VALUES
 ('t1','p1','Book the venue','Ask Dana about the deposit','Event','${now}','${now}'),
 ('t2','p1','Write website copy','','Content','${now}','${now}'),
 ('t3','p2','Pick a hall for the board retreat','','','${now}','${now}'),
 ('t4','p3','Reserve the hall','','','${now}','${now}'),
 ('t5','p4','Thank you letters','Call the main sponsor first','','${now}','${now}');`);

check("triggers queue every new task", sql.prepare("SELECT COUNT(*) n FROM vector_outbox").get().n === 5);
let r = await mod.processVectorOutbox(env, 64);
check("outbox is indexed", r.indexed === 5 && store.size === 5, r);
check("outbox is empty afterwards", sql.prepare("SELECT COUNT(*) n FROM vector_outbox").get().n === 0);
check("each task is in its company namespace", store.get("t1").namespace === "c1" && store.get("t4").namespace === "c2" && store.get("t1").metadata.project_id === "p1");
check("notes stay out of embeddings when note search is off", !embedded.some((t) => /Dana/.test(t)), embedded);
check("notes are embedded when note search is on", embedded.some((t) => /sponsor/.test(t)));

const visible = new Set(["p1", "p4"]); // u1 is a member: sees company projects, not the secret one
let s = await mod.hybridSearch(env, { companyId: "c1", visible, projectId: null, query: "a hall for the gala", includeNotes: true });
check("meaning finds the venue task from the word hall", s.semantic && s.results[0]?.taskId === "t1" && s.results[0].match !== "word", s.results);
check("the secret project's hall task is not returned", !s.results.some((x) => x.taskId === "t3"));
check("the other company's hall task is not returned", !s.results.some((x) => x.taskId === "t4"));
s = await mod.hybridSearch(env, { companyId: "c1", visible, projectId: null, query: "dana", includeNotes: true });
check("words find notes when notes are included", s.results.some((x) => x.taskId === "t1" && x.match !== "meaning"), s.results);
s = await mod.hybridSearch(env, { companyId: "c1", visible, projectId: null, query: "dana", includeNotes: false });
check("words skip notes when notes are not allowed", !s.results.some((x) => x.taskId === "t1" && x.match === "word"), s.results);
s = await mod.hybridSearch(env, { companyId: "c1", visible, projectId: "p1", query: "site text", includeNotes: false });
check("project scope and meaning find website copy", s.results[0]?.taskId === "t2" && s.results.every((x) => x.projectId === "p1"), s.results);
s = await mod.hybridSearch(env, { companyId: "c1", visible, projectId: null, query: "zebra quantum", includeNotes: true });
check("unrelated words find nothing", s.results.length === 0, s.results);

sql.exec(`UPDATE tasks SET status = 'done' WHERE id = 't2'`);
check("moving a card does not re-embed", sql.prepare("SELECT COUNT(*) n FROM vector_outbox").get().n === 0);
sql.exec(`UPDATE tasks SET title = 'Book the gala hall' WHERE id = 't1'`);
check("a title change queues the task", sql.prepare("SELECT op FROM vector_outbox WHERE task_id='t1'").get()?.op === "upsert");
sql.exec(`DELETE FROM tasks WHERE id = 't2'`);
r = await mod.processVectorOutbox(env, 64);
check("deletes reach the index", !store.has("t2") && r.deleted === 1 && r.indexed === 1, r);

sql.exec(`INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('t6','p1','Sponsor thank you','${now}','${now}')`);
aiFails = "Upstream error 500";
r = await mod.processVectorOutbox(env, 64);
check("a failed run keeps the task queued and counts the try", sql.prepare("SELECT attempts FROM vector_outbox WHERE task_id='t6'").get()?.attempts === 1 && !store.has("t6"));
aiFails = null;
await mod.processVectorOutbox(env, 64);
check("the next run indexes it", store.has("t6"));

sql.exec(`UPDATE projects SET ai_policy = '{"readNotes":true}' WHERE id = 'p1'`);
check("project deletes cascade to the index queue", (sql.exec(`DELETE FROM projects WHERE id = 'p3'`), sql.prepare("SELECT op FROM vector_outbox WHERE task_id='t4'").get()?.op === "delete"));

aiFails = "Binding AI needs to be run remotely";
sql.exec(`INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('t7','p1','Local only','${now}','${now}')`);
await mod.processVectorOutbox(env, 64);
s = await mod.hybridSearch(env, { companyId: "c1", visible, projectId: null, query: "gala", includeNotes: true });
check("local development falls back to words only", s.semantic === false && s.results.some((x) => x.taskId === "t1"), s);
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
if (results.some((ok) => !ok)) process.exit(1);
