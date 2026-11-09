/*
 * Comments: types, limits and input checks. Pure, so the Worker, the web app and tests share them.
 */

export const COMMENT_MAX = 4000;
export const QUOTE_MAX = 500;
export const MENTIONS_MAX = 20;
export const THREADS_MAX = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isThreadId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export interface DocComment {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface DocThread {
  id: string;
  /** The text the thread points at, as it was when the thread started. null for a comment on the whole doc. */
  quote: string | null;
  status: "open" | "resolved";
  createdBy: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  comments: DocComment[];
}

/** GET /api/apps/docs/docs/:id/threads */
export interface ThreadList {
  rev: number;
  threads: DocThread[];
  /** People who can see docs, for @mentions. */
  people: Array<{ id: string; name: string }>;
  can: {
    comment: boolean;
    /** Start a thread on text. It adds a mark to the doc, so it needs Write docs too. */
    commentOnText: boolean;
    /** Delete any comment or thread. */
    moderate: boolean;
  };
}

/** Cleans a comment: plain text, no control characters except line breaks, at most 4,000 characters. */
export function cleanBody(raw: unknown): { body: string } | { problem: string } {
  if (typeof raw !== "string") return { problem: "Type a comment." };
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) return { problem: "Type a comment." };
  if (body.length > COMMENT_MAX) return { problem: `The comment is too long. Use ${COMMENT_MAX.toLocaleString("en-US")} characters or fewer.` };
  return { body };
}

/** Cleans the quoted text of a thread: one line, at most 500 characters. */
export function cleanQuote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim();
  if (!q) return null;
  return q.length > QUOTE_MAX ? `${q.slice(0, QUOTE_MAX - 1)}…` : q;
}

/** The ids of mentioned people from the web app. Unknown values are dropped. */
export function cleanMentions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && UUID.test(v)))].slice(0, MENTIONS_MAX);
}
