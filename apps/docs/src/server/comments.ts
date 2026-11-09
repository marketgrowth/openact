import { Hono } from "hono";
import {
  HttpError,
  acceptLive,
  appUrl,
  assertLiveRequest,
  companyAppState,
  emailButton,
  emailLayout,
  escapeHtml,
  hasPermission,
  markChanged,
  newId,
  nowIso,
  readJson,
  requirePermission,
  requireUser,
  sendEmail,
  type AppEnv,
  type Env
} from "@openact/core/server";
import { THREADS_MAX, cleanBody, cleanMentions, cleanQuote, isThreadId, type DocThread, type ThreadList } from "../shared/comments";
import { loadDoc, type DocRow } from "./routes";

/*
 * Comments on docs, under /api/apps/docs.
 *   docs.comment   read threads, start threads, reply, resolve and reopen
 *   docs.edit      also needed to start a thread on text, because that adds a comment mark to the doc
 *   docs.organize  delete any comment or thread
 * People delete and change their own comments. A thread with no comments left goes away.
 * Comments have their own revision (comments_rev), so they never clash with saves of the doc.
 */

export const COMMENTS_ROOM = "docs-comments";

const displayName = (name: string | null, email: string | null) => name?.trim() || email?.split("@")[0] || "Someone";

/** A statement that marks the doc's comments as changed. */
function bumpComments(env: Env, docId: string): D1PreparedStatement {
  markChanged(COMMENTS_ROOM, docId);
  return env.DB.prepare("UPDATE docs_docs SET comments_rev = comments_rev + 1 WHERE id = ?").bind(docId);
}

async function docForComments(env: Env, docId: string, userId: string): Promise<DocRow> {
  const doc = await loadDoc(env, docId);
  await requirePermission(env, doc.company_id, userId, "docs.comment");
  return doc;
}

interface ThreadRow {
  id: string;
  doc_id: string;
  company_id: string;
  created_by: string | null;
}

async function loadThread(env: Env, id: string): Promise<ThreadRow> {
  const row = await env.DB.prepare("SELECT id, doc_id, company_id, created_by FROM docs_threads WHERE id = ?").bind(id).first<ThreadRow>();
  if (!row) throw new HttpError(404, "This comment thread does not exist. Someone may have deleted it.");
  return row;
}

/** People in the company who can see docs, for @mentions. Names only, no emails. */
async function docPeople(env: Env, companyId: string): Promise<Array<{ id: string; name: string; email: string }>> {
  const state = await companyAppState(env, companyId);
  const roles = state.roles("docs.view");
  const rows = await env.DB.prepare(
    "SELECT u.id, u.name, u.email, m.role FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY u.name COLLATE NOCASE"
  )
    .bind(companyId)
    .all<{ id: string; name: string; email: string; role: string }>();
  return rows.results.filter((r) => (roles as string[]).includes(r.role)).map((r) => ({ id: r.id, name: displayName(r.name, r.email), email: r.email }));
}

/**
 * Emails people about a new comment: the people it mentions, and the people who already wrote in the thread.
 * Never the author. Only people who can see docs. It runs after the response, so a slow email never slows the page.
 */
async function notify(env: Env, url: string, doc: DocRow, threadId: string, authorId: string, authorName: string, body: string, mentions: string[]) {
  const people = await docPeople(env, doc.company_id);
  const byId = new Map(people.map((p) => [p.id, p]));
  const before = await env.DB.prepare("SELECT DISTINCT author_id FROM docs_comments WHERE thread_id = ? AND author_id IS NOT NULL")
    .bind(threadId)
    .all<{ author_id: string }>();
  const to = new Set<string>([...mentions, ...before.results.map((r) => r.author_id)]);
  to.delete(authorId);
  const link = `${url}/a/docs/d/${doc.id}`;
  const excerpt = body.length > 600 ? `${body.slice(0, 599)}…` : body;
  for (const id of to) {
    const p = byId.get(id);
    if (!p) continue;
    const mentioned = mentions.includes(id);
    const subject = mentioned ? `${authorName} mentioned you in "${doc.title}"` : `${authorName} replied in "${doc.title}"`;
    const html = emailLayout(
      env,
      subject,
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(excerpt)}</p>${emailButton(link, "Open the doc")}`
    );
    await sendEmail(env, { to: p.email, subject, html, text: `${subject}\n\n${excerpt}\n\nOpen the doc: ${link}` }).catch((e) =>
      console.warn("[openact] docs comment email failed", e)
    );
  }
}

export const commentRoutes = new Hono<AppEnv>();

commentRoutes.get("/docs/:id/threads", async (c) => {
  const user = requireUser(c);
  const doc = await docForComments(c.env, c.req.param("id"), user.id);
  const [rev, threads, comments, people, canEdit, canModerate] = await Promise.all([
    c.env.DB.prepare("SELECT comments_rev AS rev FROM docs_docs WHERE id = ?").bind(doc.id).first<{ rev: number }>(),
    c.env.DB.prepare(
      `SELECT t.id, t.quote, t.status, t.created_by, t.resolved_at, t.created_at, u.name AS r_name, u.email AS r_email
       FROM docs_threads t LEFT JOIN users u ON u.id = t.resolved_by
       WHERE t.doc_id = ? ORDER BY t.created_at`
    )
      .bind(doc.id)
      .all<{
        id: string;
        quote: string | null;
        status: "open" | "resolved";
        created_by: string | null;
        resolved_at: string | null;
        created_at: string;
        r_name: string | null;
        r_email: string | null;
      }>(),
    c.env.DB.prepare(
      `SELECT c.id, c.thread_id, c.author_id, c.body, c.created_at, c.edited_at, u.name, u.email
       FROM docs_comments c JOIN docs_threads t ON t.id = c.thread_id LEFT JOIN users u ON u.id = c.author_id
       WHERE t.doc_id = ? ORDER BY c.created_at`
    )
      .bind(doc.id)
      .all<{
        id: string;
        thread_id: string;
        author_id: string | null;
        body: string;
        created_at: string;
        edited_at: string | null;
        name: string | null;
        email: string | null;
      }>(),
    docPeople(c.env, doc.company_id),
    hasPermission(c.env, doc.company_id, user.id, "docs.edit"),
    hasPermission(c.env, doc.company_id, user.id, "docs.organize")
  ]);
  const byThread = new Map<string, DocThread["comments"]>();
  for (const r of comments.results) {
    const list = byThread.get(r.thread_id) ?? [];
    list.push({
      id: r.id,
      authorId: r.author_id,
      authorName: r.author_id ? displayName(r.name, r.email) : "Former member",
      body: r.body,
      createdAt: r.created_at,
      editedAt: r.edited_at
    });
    byThread.set(r.thread_id, list);
  }
  const list: ThreadList = {
    rev: rev?.rev ?? 0,
    threads: threads.results.map((t) => ({
      id: t.id,
      quote: t.quote,
      status: t.status,
      createdBy: t.created_by,
      resolvedByName: t.resolved_at ? displayName(t.r_name, t.r_email) : null,
      resolvedAt: t.resolved_at,
      createdAt: t.created_at,
      comments: byThread.get(t.id) ?? []
    })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    can: { comment: true, commentOnText: canEdit, moderate: canModerate }
  };
  return c.json(list);
});

/**
 * Starts a thread. Body: { id?, body, quote?, onText?, mentions? }
 * With onText, the web app then adds a comment mark with the thread id to the selected text. The web app may send
 * the id it will use for the mark, so the mark and the thread match even if the page closes before the answer.
 */
commentRoutes.post("/docs/:id/threads", async (c) => {
  const user = requireUser(c);
  const doc = await docForComments(c.env, c.req.param("id"), user.id);
  const body = await readJson(c);
  const onText = body.onText === true;
  if (onText) await requirePermission(c.env, doc.company_id, user.id, "docs.edit");
  const r = cleanBody(body.body);
  if ("problem" in r) throw new HttpError(400, r.problem);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM docs_threads WHERE doc_id = ?").bind(doc.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= THREADS_MAX) throw new HttpError(400, `A doc can have up to ${THREADS_MAX} comment threads. Delete resolved threads first.`);
  const id = body.id === undefined ? newId() : isThreadId(body.id) ? body.id : null;
  if (!id) throw new HttpError(400, "The thread id is not valid. Load the page again.");
  const quote = onText ? cleanQuote(body.quote) : null;
  const iso = nowIso();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO docs_threads (id, company_id, doc_id, quote, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)"
      ).bind(id, doc.company_id, doc.id, quote, user.id, iso, iso),
      c.env.DB.prepare("INSERT INTO docs_comments (id, thread_id, company_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        newId(),
        id,
        doc.company_id,
        user.id,
        r.body,
        iso
      ),
      bumpComments(c.env, doc.id)
    ]);
  } catch (e) {
    if (/UNIQUE|PRIMARY/i.test(String(e))) throw new HttpError(409, "This thread already exists. Load the page again.");
    throw e;
  }
  c.executionCtx.waitUntil(notify(c.env, appUrl(c), doc, id, user.id, user.name || user.email.split("@")[0]!, r.body, cleanMentions(body.mentions)));
  return c.json({ id }, 201);
});

/** Replies in a thread. Body: { body, mentions? }. A reply reopens a resolved thread. */
commentRoutes.post("/threads/:id/comments", async (c) => {
  const user = requireUser(c);
  const thread = await loadThread(c.env, c.req.param("id"));
  const doc = await docForComments(c.env, thread.doc_id, user.id);
  const body = await readJson(c);
  const r = cleanBody(body.body);
  if ("problem" in r) throw new HttpError(400, r.problem);
  const iso = nowIso();
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO docs_comments (id, thread_id, company_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id,
      thread.id,
      thread.company_id,
      user.id,
      r.body,
      iso
    ),
    c.env.DB.prepare("UPDATE docs_threads SET status = 'open', resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?").bind(iso, thread.id),
    bumpComments(c.env, doc.id)
  ]);
  c.executionCtx.waitUntil(notify(c.env, appUrl(c), doc, thread.id, user.id, user.name || user.email.split("@")[0]!, r.body, cleanMentions(body.mentions)));
  return c.json({ id }, 201);
});

/** Resolves or reopens a thread. Body: { status: "open" | "resolved" } */
commentRoutes.patch("/threads/:id", async (c) => {
  const user = requireUser(c);
  const thread = await loadThread(c.env, c.req.param("id"));
  await docForComments(c.env, thread.doc_id, user.id);
  const body = await readJson(c);
  if (body.status !== "open" && body.status !== "resolved") throw new HttpError(400, "Status must be open or resolved.");
  const iso = nowIso();
  await c.env.DB.batch([
    body.status === "resolved"
      ? c.env.DB.prepare("UPDATE docs_threads SET status = 'resolved', resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?").bind(
          user.id,
          iso,
          iso,
          thread.id
        )
      : c.env.DB.prepare("UPDATE docs_threads SET status = 'open', resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?").bind(iso, thread.id),
    bumpComments(c.env, thread.doc_id)
  ]);
  return c.json({ ok: true });
});

/** Deletes a thread and its comments. The person who started it, or an organizer, can do this. */
commentRoutes.delete("/threads/:id", async (c) => {
  const user = requireUser(c);
  const thread = await loadThread(c.env, c.req.param("id"));
  const doc = await docForComments(c.env, thread.doc_id, user.id);
  if (thread.created_by !== user.id && !(await hasPermission(c.env, doc.company_id, user.id, "docs.organize")))
    throw new HttpError(403, "Only the person who started this thread, or someone who can organize the library, can delete it.", "no_permission");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM docs_threads WHERE id = ?").bind(thread.id), bumpComments(c.env, doc.id)]);
  return c.json({ ok: true });
});

async function loadComment(env: Env, id: string) {
  const row = await env.DB.prepare(
    "SELECT c.id, c.thread_id, c.author_id, t.doc_id, t.company_id FROM docs_comments c JOIN docs_threads t ON t.id = c.thread_id WHERE c.id = ?"
  )
    .bind(id)
    .first<{ id: string; thread_id: string; author_id: string | null; doc_id: string; company_id: string }>();
  if (!row) throw new HttpError(404, "This comment does not exist. Someone may have deleted it.");
  return row;
}

/** Changes a comment. Only its author can do this. Body: { body } */
commentRoutes.patch("/comments/:id", async (c) => {
  const user = requireUser(c);
  const cm = await loadComment(c.env, c.req.param("id"));
  await docForComments(c.env, cm.doc_id, user.id);
  if (cm.author_id !== user.id) throw new HttpError(403, "You can change only your own comments.", "no_permission");
  const r = cleanBody((await readJson(c)).body);
  if ("problem" in r) throw new HttpError(400, r.problem);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE docs_comments SET body = ?, edited_at = ? WHERE id = ?").bind(r.body, nowIso(), cm.id),
    bumpComments(c.env, cm.doc_id)
  ]);
  return c.json({ ok: true });
});

/** Deletes a comment. Its author or an organizer can do this. A thread with no comments left goes away too. */
commentRoutes.delete("/comments/:id", async (c) => {
  const user = requireUser(c);
  const cm = await loadComment(c.env, c.req.param("id"));
  await docForComments(c.env, cm.doc_id, user.id);
  if (cm.author_id !== user.id && !(await hasPermission(c.env, cm.company_id, user.id, "docs.organize")))
    throw new HttpError(403, "You can delete only your own comments.", "no_permission");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM docs_comments WHERE id = ?").bind(cm.id),
    c.env.DB.prepare("DELETE FROM docs_threads WHERE id = ? AND NOT EXISTS (SELECT 1 FROM docs_comments WHERE thread_id = ?)").bind(cm.thread_id, cm.thread_id),
    bumpComments(c.env, cm.doc_id)
  ]);
  const left = await c.env.DB.prepare("SELECT 1 AS x FROM docs_threads WHERE id = ?").bind(cm.thread_id).first();
  return c.json({ ok: true, threadDeleted: !left });
});

commentRoutes.get("/docs/:id/comments/live", async (c) => {
  const user = requireUser(c);
  assertLiveRequest(c);
  const doc = await docForComments(c.env, c.req.param("id"), user.id);
  const row = await c.env.DB.prepare("SELECT comments_rev AS rev FROM docs_docs WHERE id = ?").bind(doc.id).first<{ rev: number }>();
  return acceptLive(c, COMMENTS_ROOM, doc.id, { userId: user.id, name: user.name || user.email.split("@")[0]! }, row?.rev ?? 0);
});
