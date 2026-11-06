/*
 * Pure parts of search: what to embed, how to merge keyword and meaning results,
 * and which tasks the agent sees on big projects. Node unit tests import this file.
 */

/** Workers AI embedding model. 768 dimensions, so the Vectorize index uses 768 too. */
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBED_DIMENSIONS = 768;
export const VECTOR_INDEX = "openact-tasks";

export interface EmbedSource {
  title: string;
  phase: string;
  notes: string;
  /** The project's "Let the agent search task notes" setting. Notes are embedded only when it is on. */
  readNotes: boolean;
}

/** The text that is embedded for a task. Notes go to the AI provider only when the project allows note search. */
export function embedText(t: EmbedSource): string {
  const parts = [t.title.trim()];
  if (t.phase.trim()) parts.push(`Phase: ${t.phase.trim()}`);
  if (t.readNotes && t.notes.trim()) parts.push(t.notes.replace(/\s+/g, " ").trim().slice(0, 1500));
  return parts.join("\n");
}

export interface OutboxRow {
  task_id: string;
  op: "upsert" | "delete";
  queued_at: number;
}

export interface TaskForIndex {
  id: string;
  title: string;
  phase: string;
  notes: string;
  project_id: string;
  company_id: string | null;
  read_notes: boolean;
}

export interface IndexPlan {
  deletes: string[];
  upserts: Array<{ id: string; text: string; namespace: string; projectId: string }>;
}

/** Turns outbox rows into Vectorize work. A task that is gone, or has no company, is deleted from the index. */
export function planOutbox(rows: OutboxRow[], tasks: TaskForIndex[]): IndexPlan {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const plan: IndexPlan = { deletes: [], upserts: [] };
  for (const r of rows) {
    const t = byId.get(r.task_id);
    if (r.op === "delete" || !t || !t.company_id) {
      plan.deletes.push(r.task_id);
      continue;
    }
    plan.upserts.push({
      id: t.id,
      text: embedText({ title: t.title, phase: t.phase, notes: t.notes, readNotes: t.read_notes }),
      namespace: t.company_id,
      projectId: t.project_id
    });
  }
  return plan;
}

export type MatchKind = "word" | "meaning" | "both";

/**
 * Reciprocal rank fusion: each list adds 1 / (k + rank) for an id. Ids found by both lists rise to the top.
 * k = 60 is the usual value. It keeps one very high rank from hiding everything else.
 */
export function mergeRanked(keyword: string[], meaning: string[], k = 60): Array<{ id: string; score: number; match: MatchKind }> {
  const score = new Map<string, number>();
  const seenK = new Set(keyword);
  const seenM = new Set(meaning);
  keyword.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  meaning.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s, match: (seenK.has(id) && seenM.has(id) ? "both" : seenK.has(id) ? "word" : "meaning") as MatchKind }))
    .sort((a, b) => b.score - a.score);
}

/** Keeps only the matches in projects that the person can see. Vector results are never trusted on their own. */
export function allowedMatches<T extends { projectId: string }>(matches: T[], visibleProjectIds: Set<string>): T[] {
  return matches.filter((m) => visibleProjectIds.has(m.projectId));
}

/** Simple keyword relevance: words in the title count most, then the phase, then the notes. */
export function keywordScore(terms: string[], t: { title: string; phase: string; notes: string }): number {
  const title = t.title.toLowerCase();
  const phase = t.phase.toLowerCase();
  const notes = t.notes.toLowerCase();
  let s = 0;
  for (const term of terms) {
    if (title.includes(term)) s += 3;
    if (phase.includes(term)) s += 2;
    if (notes.includes(term)) s += 1;
  }
  return s;
}

export const PROMPT_TASK_LIMIT = 80;

export type PromptTaskRow = Record<string, unknown>;

/**
 * On big projects the agent gets a subset of tasks: the ones that match the message,
 * then work in progress, late work and work due soon. It can call search_tasks for the rest.
 */
export function pickTasksForPrompt<T extends PromptTaskRow>(rows: T[], relevantIds: string[], today: string, limit = PROMPT_TASK_LIMIT): { rows: T[]; hidden: number } {
  if (rows.length <= limit) return { rows, hidden: 0 };
  const chosen = new Map<string, T>();
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  for (const id of relevantIds) {
    const r = byId.get(id);
    if (r && chosen.size < Math.ceil(limit / 2)) chosen.set(id, r);
  }
  const open = rows.filter((r) => r.status !== "done");
  const urgency = (r: T) => {
    const end = typeof r.end_date === "string" ? r.end_date : "";
    if (r.status === "doing" || r.status === "review") return 0;
    if (end && end < today) return 1;
    if (end) return 2;
    return 3;
  };
  const rest = [...open].sort((a, b) => urgency(a) - urgency(b) || String(a.end_date ?? "9999").localeCompare(String(b.end_date ?? "9999")));
  for (const r of rest) {
    if (chosen.size >= limit) break;
    chosen.set(String(r.id), r);
  }
  const picked = rows.filter((r) => chosen.has(String(r.id)));
  return { rows: picked, hidden: rows.length - picked.length };
}
