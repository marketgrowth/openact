import { HttpError, aiText, newId, text, type Env } from "@openact/core/server";
import { EventType, UNTRUSTED_TEXT_RULE, encodeSse, untrustedText, type AguiEvent } from "@openact/core/shared";
import {
  ASK_CHUNKS,
  ASK_EVENT,
  ASK_RESOURCES,
  FORMAT_LABEL,
  MAX_HISTORY,
  MAX_QUESTION,
  type AskCitation,
  type AskCitations,
  type AskSearched,
  type Format,
  type Settings
} from "../shared/rules.ts";
import { askChunks } from "./store.ts";

/*
 * Ask: retrieval-augmented answers from the published library, over AG-UI.
 * 1. Rank the chunks of the published resources for the question with BM25 (keyword search, no embeddings).
 * 2. Send the best chunks to the model, grouped by resource and numbered, as labeled data (aiText, with the person's own AI rules).
 * 3. Stream AG-UI events: the search step, the answer, and the resources it cites (CUSTOM "library.citations").
 * Only published resources go to the model. No chunk matched: no model call.
 */

export interface Chunk {
  resourceId: string;
  seq: number;
  text: string;
  title: string;
  format: Format;
  sourceUrl: string;
  /** A private My Library item of the person who asks. */
  personal?: boolean;
}

const STOP = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its me my of on or our should so that the their them there these they this to was we what when where which who why will with you your about after any before into more must not only out over than then too under until up use used very".split(
    " "
  )
);

/** Words for search: lower case, letters and digits, two characters or more, common words dropped. */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** BM25 over each chunk, with its resource title counted twice. Returns the best chunks from at most `maxResources` resources. */
export function rankChunks(chunks: Chunk[], query: string, k = ASK_CHUNKS, maxResources = ASK_RESOURCES): Chunk[] {
  const q = [...new Set(words(query))];
  if (!q.length || !chunks.length) return [];
  const toks = chunks.map((c) => [...words(c.title), ...words(c.title), ...words(c.text)]);
  const avg = toks.reduce((n, t) => n + t.length, 0) / toks.length || 1;
  const df = new Map(q.map((w) => [w, toks.filter((t) => t.includes(w)).length]));
  const N = chunks.length;
  const scored = chunks
    .map((c, i) => {
      const t = toks[i]!;
      let score = 0;
      for (const w of q) {
        const f = t.filter((x) => x === w).length;
        if (!f) continue;
        const n = df.get(w)!;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (t.length / avg)));
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const out: Chunk[] = [];
  const resources = new Set<string>();
  for (const { c } of scored) {
    if (!resources.has(c.resourceId) && resources.size >= maxResources) continue;
    resources.add(c.resourceId);
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

/** The question and the earlier turns from an AG-UI RunAgentInput body. */
export function readRunInput(raw: unknown): { threadId: string; runId: string; question: string; history: AskTurn[]; resourceId: string | null } {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Send the question as an AG-UI RunAgentInput.");
  const b = raw as Record<string, unknown>;
  const msgs = Array.isArray(b.messages) ? (b.messages as Array<Record<string, unknown>>) : [];
  const turns: AskTurn[] = msgs
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as AskTurn["role"], content: String(m.content) }));
  const last = turns.at(-1);
  if (!last || last.role !== "user") throw new HttpError(400, "Type a question.");
  const question = text(last.content, "Question", { max: MAX_QUESTION, required: true });
  const history = turns
    .slice(0, -1)
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));
  const fp = b.forwardedProps && typeof b.forwardedProps === "object" ? (b.forwardedProps as Record<string, unknown>) : {};
  const resourceId = typeof fp.resourceId === "string" && fp.resourceId.length <= 64 ? fp.resourceId : null;
  const id = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 100 ? v : newId());
  return { threadId: id(b.threadId), runId: id(b.runId), question, history, resourceId };
}

/** Chunks grouped by resource, in rank order. The group number is the citation number. */
type Group = { n: number; resourceId: string; title: string; format: Format; sourceUrl: string; personal: boolean; parts: string[] };

export function groupByResource(picked: Chunk[]): Group[] {
  const groups = new Map<string, Group>();
  for (const c of picked) {
    let g = groups.get(c.resourceId);
    if (!g) {
      g = { n: groups.size + 1, resourceId: c.resourceId, title: c.title, format: c.format, sourceUrl: c.sourceUrl, personal: !!c.personal, parts: [] };
      groups.set(c.resourceId, g);
    }
    g.parts.push(c.text);
  }
  return [...groups.values()];
}

export function systemPrompt(s: Settings, groups: ReturnType<typeof groupByResource>): string {
  const list = groups
    .map((g) => [`[${g.n}] ${FORMAT_LABEL[g.format]}${g.personal ? " (the reader's own private item)" : ""}: ${g.title}`, g.sourceUrl ? `Link: ${g.sourceUrl}` : "", ...g.parts].filter(Boolean).join("\n"))
    .join("\n\n");
  return [
    `You answer questions for the readers of a resource library called "${s.title}". Use only the numbered resources below.`,
    "Cite each fact with the number of its resource in square brackets, such as [1] or [2][3].",
    "If the resources do not answer the question, say that the library does not cover it yet, and suggest other words to search for.",
    "Keep the answer short: up to six sentences, or a short list. Use plain words.",
    "Do not give legal, tax or medical advice. Say what the resources say, and tell the reader to open the resource.",
    s.notice ? `The site's notice to readers: ${s.notice}` : "",
    UNTRUSTED_TEXT_RULE,
    "Resources:",
    untrustedText(list, "shared")
  ]
    .filter(Boolean)
    .join("\n");
}

/** The resources an answer cites. Numbers outside the list are dropped from the answer. */
export function citationsOf(answer: string, groups: ReturnType<typeof groupByResource>): { answer: string; citations: AskCitation[]; related: AskCitation[] } {
  const used = new Set<number>();
  const clean = answer.replace(/\[(\d{1,2})\]/g, (m, n) => {
    const i = Number(n);
    if (i >= 1 && i <= groups.length) {
      used.add(i);
      return m;
    }
    return "";
  });
  const cite = (g: (typeof groups)[number]): AskCitation => ({ n: g.n, id: g.resourceId, title: g.title, format: g.format, sourceUrl: g.sourceUrl, personal: g.personal });
  return {
    answer: clean.trim(),
    citations: groups.filter((g) => used.has(g.n)).map(cite),
    related: groups.filter((g) => !used.has(g.n)).slice(0, 3).map(cite)
  };
}

export const NO_MATCH = "The library and My Library have nothing about this yet. Try other words, or browse the library.";

/** Runs one Ask turn and streams it as AG-UI events. */
export function askStream(env: Env, companyId: string, userId: string, s: Settings, input: ReturnType<typeof readRunInput>, waitUntil: (p: Promise<unknown>) => void): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (e: AguiEvent) => writer.write(enc.encode(encodeSse(e)));
  const { threadId, runId } = input;

  const run = async () => {
    try {
      await send({ type: EventType.RUN_STARTED, threadId, runId });
      await send({ type: EventType.STEP_STARTED, stepName: "search" });
      const chunks = await askChunks(env, companyId, userId, input.resourceId ?? undefined);
      // A follow-up such as "and for new staff?" needs the words of the question before it.
      const lastUser = input.history.filter((t) => t.role === "user").at(-1)?.content ?? "";
      let picked = rankChunks(chunks, input.question);
      if (!picked.length && lastUser) picked = rankChunks(chunks, `${lastUser} ${input.question}`);
      // "Ask about this" with no word match still reads the start of that one resource.
      if (!picked.length && input.resourceId) picked = chunks.slice(0, ASK_CHUNKS);
      const groups = groupByResource(picked);
      const searched: AskSearched = { searched: new Set(chunks.map((c) => c.resourceId)).size, read: groups.length };
      await send({ type: EventType.CUSTOM, name: ASK_EVENT.searched, value: searched });
      await send({ type: EventType.STEP_FINISHED, stepName: "search" });

      let answer = NO_MATCH;
      let cites: AskCitations = { citations: [], related: [], ai: null };
      if (groups.length) {
        await send({ type: EventType.STEP_STARTED, stepName: "answer" });
        const out = await aiText(env, companyId, userId, {
          system: systemPrompt(s, groups),
          messages: [...input.history, { role: "user", content: input.question }],
          maxTokens: 700
        });
        const r = citationsOf(out.text || "The AI gave no answer. Try again.", groups);
        answer = r.answer;
        cites = { citations: r.citations, related: r.related, ai: { provider: out.provider, model: out.model, source: out.source } };
        await send({ type: EventType.STEP_FINISHED, stepName: "answer" });
      }
      const messageId = newId();
      await send({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
      await send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: answer });
      await send({ type: EventType.TEXT_MESSAGE_END, messageId });
      await send({ type: EventType.CUSTOM, name: ASK_EVENT.citations, value: cites });
      await send({ type: EventType.RUN_FINISHED, threadId, runId });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : "Something went wrong. Try again.";
      if (!(err instanceof HttpError)) console.error(`[library] Ask failed: ${(err as Error).message}`);
      await send({ type: EventType.RUN_ERROR, message }).catch(() => undefined);
    } finally {
      await writer.close().catch(() => undefined);
    }
  };
  waitUntil(run());
  return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
