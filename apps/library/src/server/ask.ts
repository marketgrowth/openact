import { HttpError, aiText, text, type Env } from "@openact/core/server";
import { UNTRUSTED_TEXT_RULE, untrustedText } from "@openact/core/shared";
import {
  ASK_ITEMS,
  MAX_HISTORY,
  MAX_QUESTION,
  type AskAnswer,
  type AskCitation,
  type AskTurn,
  type ItemKind,
  type PublishedSource,
  type PublishedUpdate,
  type Settings
} from "../shared/rules.ts";

/*
 * Ask: retrieval-augmented answers from the published library.
 * 1. Rank the published items for the question with BM25 (keyword search, no embeddings).
 * 2. Send the best items to the model as numbered, labeled data, with the person's own AI rules (aiText).
 * 3. Return the answer and the items it cites.
 * Only published copies go to the model. No item matched: no model call.
 */

/** One published item, flattened for search and for the prompt. */
export interface AskDoc {
  kind: ItemKind;
  id: string;
  title: string;
  body: string;
  sourceUrl: string;
  date: string | null;
}

export function docsFrom(sources: PublishedSource[], updates: PublishedUpdate[], s: Settings): AskDoc[] {
  const l = s.fieldLabels;
  return [
    ...sources.map((x) => ({
      kind: "source" as const,
      id: x.id,
      title: x.title,
      body: [x.citation && `Citation: ${x.citation}`, x.summary && `Summary: ${x.summary}`, x.details].filter(Boolean).join("\n"),
      sourceUrl: x.sourceUrl,
      date: x.lastCheckedDate
    })),
    ...updates.map((x) => ({
      kind: "update" as const,
      id: x.id,
      title: x.title,
      body: [
        x.whatChanged && `${l.whatChanged}: ${x.whatChanged}`,
        x.whoAffected && `${l.whoAffected}: ${x.whoAffected}`,
        x.action && `${l.action}: ${x.action}`,
        x.actionDueDate && `${l.dueDate}: ${x.actionDueDate}`
      ]
        .filter(Boolean)
        .join("\n"),
      sourceUrl: x.sourceUrl,
      date: x.publishedDate
    }))
  ];
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

/** BM25 over the title (counted twice) and the body. Returns the best items with a score above zero. */
export function rank(docs: AskDoc[], query: string, k = ASK_ITEMS): AskDoc[] {
  const q = [...new Set(words(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => [...words(d.title), ...words(d.title), ...words(d.body)]);
  const avg = toks.reduce((n, t) => n + t.length, 0) / toks.length || 1;
  const df = new Map(q.map((w) => [w, toks.filter((t) => t.includes(w)).length]));
  const N = docs.length;
  const scored = docs.map((d, i) => {
    const t = toks[i]!;
    let score = 0;
    for (const w of q) {
      const f = t.filter((x) => x === w).length;
      if (!f) continue;
      const n = df.get(w)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (t.length / avg)));
    }
    return { d, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.d);
}

export function cleanQuestion(raw: unknown): string {
  return text(raw, "Question", { max: MAX_QUESTION, required: true });
}

/** The earlier turns the web app sends back. Only the last few, each cut to a safe length. */
export function cleanHistory(raw: unknown): AskTurn[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, "History must be a list.");
  return raw
    .filter((t): t is AskTurn => !!t && typeof t === "object" && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));
}

export function systemPrompt(s: Settings, items: AskDoc[]): string {
  const list = items
    .map((d, i) =>
      [`[${i + 1}] ${d.kind === "source" ? s.sourcesName : s.updatesName}: ${d.title}`, d.date ? `Date: ${d.date}` : "", d.body, d.sourceUrl ? `Link: ${d.sourceUrl}` : ""]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
  return [
    `You answer questions for the readers of "${s.title}". Use only the numbered library items below.`,
    "Cite each fact with the number of its item in square brackets, such as [1] or [2][3].",
    "If the items do not answer the question, say that the library does not cover it yet, and suggest other words to search for.",
    "Keep the answer short: up to six sentences, or a short list. Use plain words.",
    "Do not give legal, tax or medical advice. Say what the items say, and tell the reader to check the source.",
    s.notice ? `The site's notice to readers: ${s.notice}` : "",
    UNTRUSTED_TEXT_RULE,
    "Library items:",
    untrustedText(list, "shared")
  ]
    .filter(Boolean)
    .join("\n");
}

const cite = (d: AskDoc, n: number): AskCitation => ({ n, kind: d.kind, id: d.id, title: d.title, sourceUrl: d.sourceUrl });

/** The items an answer cites. Numbers outside the list are dropped from the answer. */
export function citationsOf(answer: string, items: AskDoc[]): { answer: string; citations: AskCitation[]; related: AskCitation[] } {
  const used = new Set<number>();
  const clean = answer.replace(/\[(\d{1,2})\]/g, (m, n) => {
    const i = Number(n);
    if (i >= 1 && i <= items.length) {
      used.add(i);
      return m;
    }
    return "";
  });
  const citations = [...used].sort((a, b) => a - b).map((n) => cite(items[n - 1]!, n));
  const related = items.map((d, i) => cite(d, i + 1)).filter((c) => !used.has(c.n)).slice(0, 3);
  return { answer: clean.trim(), citations, related };
}

export const NO_MATCH = "The library has no published item about this yet. Try other words, or browse the items below.";

export async function ask(
  env: Env,
  companyId: string,
  userId: string,
  s: Settings,
  docs: AskDoc[],
  question: string,
  history: AskTurn[]
): Promise<AskAnswer> {
  // A follow-up such as "and for 7 beds?" needs the words of the question before it.
  const lastUser = history.filter((t) => t.role === "user").at(-1)?.content ?? "";
  let items = rank(docs, question);
  if (!items.length && lastUser) items = rank(docs, `${lastUser} ${question}`);
  if (!items.length) return { answer: NO_MATCH, citations: [], related: [], ai: null };
  const out = await aiText(env, companyId, userId, {
    system: systemPrompt(s, items),
    messages: [...history, { role: "user", content: question }],
    maxTokens: 700
  });
  const r = citationsOf(out.text || "The AI gave no answer. Try again.", items);
  return { ...r, ai: { provider: out.provider, model: out.model, source: out.source } };
}
