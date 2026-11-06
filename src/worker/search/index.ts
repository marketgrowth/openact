import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { COMPANY_ROLES, type ProjectColor } from "../../shared/types";
import { parsePolicy } from "../../shared/agent-policy";
import { projectAccess, requireCompanyRole, visibleProjectIds } from "../data";
import { currentCompanyId } from "../companies";
import { likePattern, searchTerms, snippet } from "../agent/notes";
import { HttpError, requireUser } from "../util";
import { EMBED_MODEL, allowedMatches, keywordScore, mergeRanked, planOutbox, type MatchKind, type OutboxRow, type TaskForIndex } from "./rank";

/*
 * Hybrid search: words (D1) plus meaning (Vectorize).
 *
 * - One Vectorize namespace per company, so a query never reaches another company's tasks.
 * - Every result is checked again against the projects the person can see. Vector results are never trusted alone.
 * - Without a Vectorize binding, or when it fails, search still works with words only.
 */

const STOPWORDS = new Set(
  "a an and are as at be by can do for from have how i in is it me my of on or our show that the this to was what when where which who why with you your about any anything all find tasks task".split(" ")
);

/** A meaning match must be this similar (cosine), and close to the best match. Tune with real data. */
const MIN_MEANING_SCORE = 0.6;
const MEANING_WINDOW = 0.12;

/** Set when the bindings cannot run here (local development). Saves a failing call on every request. */
let unavailableHere = false;
const isUnavailableError = (err: unknown) => /run remotely|not supported|local development/i.test(String(err));

export const vectorsEnabled = (env: Env): boolean => !!env.VECTORS && !!env.AI && !unavailableHere;

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const model = ((env.AI_EMBED_MODEL || "").trim() || EMBED_MODEL) as Parameters<Ai["run"]>[0];
  const gatewayId = (env.AI_GATEWAY_ID || "").trim();
  const run = (withGateway: boolean) =>
    env.AI.run(model, { text: texts } as never, withGateway && gatewayId ? ({ gateway: { id: gatewayId } } as never) : undefined) as Promise<{ data?: number[][] }>;
  let out: { data?: number[][] };
  try {
    out = await run(true);
  } catch (err) {
    if (!gatewayId || /run remotely/i.test(String(err))) throw err;
    out = await run(false);
  }
  if (!out?.data || out.data.length !== texts.length) throw new Error("The embedding model returned no vectors.");
  return out.data;
}

/** Indexes the tasks waiting in the outbox. Safe to call often: it does nothing when the outbox is empty. */
export async function processVectorOutbox(env: Env, limit = 64): Promise<{ indexed: number; deleted: number }> {
  if (!vectorsEnabled(env)) return { indexed: 0, deleted: 0 };
  const rows = (
    await env.DB.prepare("SELECT task_id, op, queued_at FROM vector_outbox WHERE attempts < 8 ORDER BY queued_at LIMIT ?").bind(Math.min(limit, 90)).all<OutboxRow>()
  ).results;
  if (!rows.length) return { indexed: 0, deleted: 0 };
  const marks = rows.map(() => "?").join(", ");
  const tasks = (
    await env.DB.prepare(
      `SELECT t.id, t.title, t.phase, t.notes, t.project_id, p.company_id, p.ai_policy FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id IN (${marks})`
    )
      .bind(...rows.map((r) => r.task_id))
      .all<Omit<TaskForIndex, "read_notes"> & { ai_policy: string }>()
  ).results.map((t): TaskForIndex => ({ ...t, read_notes: parsePolicy(t.ai_policy).readNotes }));
  const plan = planOutbox(rows, tasks);
  try {
    if (plan.deletes.length) await env.VECTORS!.deleteByIds(plan.deletes);
    for (let i = 0; i < plan.upserts.length; i += 32) {
      const chunk = plan.upserts.slice(i, i + 32);
      const vectors = await embed(env, chunk.map((u) => u.text));
      await env.VECTORS!.upsert(chunk.map((u, j) => ({ id: u.id, values: vectors[j]!, namespace: u.namespace, metadata: { project_id: u.projectId } })));
    }
    // Remove only rows that did not change while this ran.
    await env.DB.batch(rows.map((r) => env.DB.prepare("DELETE FROM vector_outbox WHERE task_id = ? AND queued_at = ?").bind(r.task_id, r.queued_at)));
    return { indexed: plan.upserts.length, deleted: plan.deletes.length };
  } catch (err) {
    if (isUnavailableError(err)) {
      unavailableHere = true;
      console.warn("[openact] Search by meaning is not available here (local development). Search uses words only.");
      return { indexed: 0, deleted: 0 };
    }
    console.warn("[openact] Search indexing failed. It tries again later.", err);
    await env.DB.prepare(`UPDATE vector_outbox SET attempts = attempts + 1 WHERE task_id IN (${marks})`).bind(...rows.map((r) => r.task_id)).run();
    return { indexed: 0, deleted: 0 };
  }
}

/** Queues every task in a project for indexing again, for example after note search is turned on or off. */
export function reindexProjectStatement(env: Env, projectId: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO vector_outbox (task_id, op, queued_at) SELECT id, 'upsert', ? FROM tasks WHERE project_id = ?
     ON CONFLICT (task_id) DO UPDATE SET op = 'upsert', queued_at = excluded.queued_at, attempts = 0`
  ).bind(Date.now(), projectId);
}

interface Hit {
  taskId: string;
  projectId: string;
  score: number;
}

/** Tasks found by meaning, or null when meaning search is not available. */
async function meaningSearch(env: Env, companyId: string, input: string | number[], projectId: string | null, topK = 30): Promise<Hit[] | null> {
  if (!vectorsEnabled(env)) return null;
  try {
    const values = typeof input === "string" ? (await embed(env, [input]))[0]! : input;
    const base = { topK: Math.min(topK, 50), namespace: companyId, returnMetadata: "all" as const };
    let res = await env.VECTORS!.query(values, projectId ? { ...base, filter: { project_id: projectId } } : base);
    // Without the project_id metadata index, the filter finds nothing. Fall back to the whole company.
    if (projectId && !res.matches.length) res = await env.VECTORS!.query(values, base);
    const hits = res.matches.map((m) => ({ taskId: m.id, projectId: String(m.metadata?.project_id ?? ""), score: m.score }));
    const best = hits[0]?.score ?? 0;
    return hits.filter((h) => h.score >= MIN_MEANING_SCORE && h.score >= best - MEANING_WINDOW && (!projectId || h.projectId === projectId));
  } catch (err) {
    if (isUnavailableError(err)) unavailableHere = true;
    else console.warn("[openact] Search by meaning failed, so search used words only.", err);
    return null;
  }
}

async function wordSearch(env: Env, companyId: string, projectId: string | null, terms: string[], includeNotes: boolean): Promise<Hit[]> {
  if (!terms.length) return [];
  const fields = includeNotes ? ["title", "phase", "notes"] : ["title", "phase"];
  const cond = terms.map(() => `(${fields.map((f) => `LOWER(t.${f}) LIKE ? ESCAPE '\\'`).join(" OR ")})`).join(" OR ");
  const binds = terms.flatMap((t) => fields.map(() => likePattern(t)));
  const scope = projectId ? "t.project_id = ?" : "t.project_id IN (SELECT id FROM projects WHERE company_id = ?)";
  const rows = await env.DB.prepare(`SELECT t.id, t.project_id, t.title, t.phase, t.notes FROM tasks t WHERE ${scope} AND (${cond}) LIMIT 300`)
    .bind(projectId ?? companyId, ...binds)
    .all<{ id: string; project_id: string; title: string; phase: string; notes: string }>();
  return rows.results
    .map((r) => ({ taskId: r.id, projectId: r.project_id, score: keywordScore(terms, { title: r.title, phase: r.phase, notes: includeNotes ? r.notes : "" }) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function queryTerms(query: string): string[] {
  const all = searchTerms(query);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

export interface HybridResult {
  results: Array<{ taskId: string; projectId: string; score: number; match: MatchKind }>;
  /** True when meaning search ran. */
  semantic: boolean;
  terms: string[];
}

/** Searches the projects in `visible`. With projectId, only that project. */
export async function hybridSearch(
  env: Env,
  opts: { companyId: string; visible: Set<string>; projectId: string | null; query: string; includeNotes: boolean; limit?: number }
): Promise<HybridResult> {
  const terms = queryTerms(opts.query);
  const [words, meaning] = await Promise.all([
    wordSearch(env, opts.companyId, opts.projectId, terms, opts.includeNotes),
    meaningSearch(env, opts.companyId, opts.query, opts.projectId)
  ]);
  const w = allowedMatches(words, opts.visible).slice(0, 30);
  const m = meaning ? allowedMatches(meaning, opts.visible) : [];
  const projectOf = new Map([...w, ...m].map((h) => [h.taskId, h.projectId]));
  const merged = mergeRanked(
    w.map((h) => h.taskId),
    m.map((h) => h.taskId)
  )
    .slice(0, opts.limit ?? 20)
    .map((r) => ({ taskId: r.id, projectId: projectOf.get(r.id) ?? "", score: r.score, match: r.match }));
  return { results: merged, semantic: meaning !== null, terms };
}

/* Routes */

export const searchRoutes = new Hono<AppEnv>();

type TaskDetail = {
  id: string;
  title: string;
  phase: string;
  notes: string;
  project_id: string;
  start_date: string | null;
  end_date: string | null;
  column_name: string | null;
  project_name: string;
  color: ProjectColor;
};

async function taskDetails(env: Env, ids: string[]): Promise<Map<string, TaskDetail>> {
  if (!ids.length) return new Map();
  const rows = await env.DB.prepare(
    `SELECT t.id, t.title, t.phase, t.notes, t.project_id, t.start_date, t.end_date, c.name AS column_name, p.name AS project_name, p.color
     FROM tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN board_columns c ON c.id = t.column_id
     WHERE t.id IN (${ids.map(() => "?").join(", ")})`
  )
    .bind(...ids)
    .all<TaskDetail>();
  return new Map(rows.results.map((r) => [r.id, r]));
}

/** GET /api/search?q=...&company=ID&project=ID */
searchRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const q = (c.req.query("q") || "").trim().slice(0, 200);
  const companyId = c.req.query("company") || (await currentCompanyId(c.env, user.id));
  if (!companyId) return c.json({ results: [], semantic: false });
  await requireCompanyRole(c.env, companyId, user.id, [...COMPANY_ROLES]);
  const projectId = c.req.query("project") || null;
  const visibleList = await visibleProjectIds(c.env, companyId, user.id);
  const visible = new Set(visibleList.map((p) => p.id));
  if (projectId && !visible.has(projectId)) throw new HttpError(404, "This project does not exist, or you do not have access to it.");
  if (q.length < 2) return c.json({ results: [], semantic: vectorsEnabled(c.env) });

  // People can read the notes of every project they can see, so their own search includes notes.
  const found = await hybridSearch(c.env, { companyId, visible, projectId, query: q, includeNotes: true });
  const details = await taskDetails(c.env, found.results.map((r) => r.taskId));
  const results = found.results
    .map((r) => {
      const d = details.get(r.taskId);
      if (!d || !visible.has(d.project_id)) return null;
      const inNotes = found.terms.some((t) => d.notes.toLowerCase().includes(t)) && !found.terms.some((t) => d.title.toLowerCase().includes(t));
      return {
        taskId: d.id,
        projectId: d.project_id,
        projectName: d.project_name,
        projectColor: d.color,
        title: d.title,
        phase: d.phase,
        column: d.column_name,
        start: d.start_date,
        end: d.end_date,
        snippet: inNotes ? snippet(d.notes, found.terms, false) : "",
        match: r.match
      };
    })
    .filter(Boolean);
  return c.json({ results, semantic: found.semantic });
});

/** GET /api/search/related/:taskId: tasks with a similar meaning, in projects the person can see. */
searchRoutes.get("/related/:taskId", async (c) => {
  const user = requireUser(c);
  const taskId = c.req.param("taskId");
  const task = await c.env.DB.prepare("SELECT t.id, t.project_id, p.company_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?")
    .bind(taskId)
    .first<{ id: string; project_id: string; company_id: string | null }>();
  if (!task) throw new HttpError(404, "This task does not exist.");
  const access = await projectAccess(c.env, task.project_id, user.id);
  if (!access?.role) throw new HttpError(404, "This task does not exist, or you do not have access to it.");
  if (!vectorsEnabled(c.env) || !task.company_id) return c.json({ available: false, results: [] });
  let values: number[] | null = null;
  try {
    const [v] = await c.env.VECTORS!.getByIds([taskId]);
    values = v?.values ? Array.from(v.values as ArrayLike<number>) : null;
  } catch {
    values = null;
  }
  if (!values) return c.json({ available: true, results: [] });
  const hits = await meaningSearch(c.env, task.company_id, values, null, 12);
  const visible = new Set((await visibleProjectIds(c.env, task.company_id, user.id)).map((p) => p.id));
  const ids = allowedMatches(hits ?? [], visible)
    .filter((h) => h.taskId !== taskId)
    .slice(0, 5)
    .map((h) => h.taskId);
  const details = await taskDetails(c.env, ids);
  const results = ids
    .map((id) => details.get(id))
    .filter((d): d is TaskDetail => !!d)
    .map((d) => ({ taskId: d.id, projectId: d.project_id, projectName: d.project_name, projectColor: d.color, title: d.title, column: d.column_name }));
  return c.json({ available: true, results });
});
