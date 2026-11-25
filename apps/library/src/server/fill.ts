import { aiText, type Env } from "@openact/core/server";
import { UNTRUSTED_TEXT_RULE, untrustedText } from "@openact/core/shared";
import type { Settings, Term } from "../shared/rules.ts";

/*
 * AI fill: writes a short summary and picks a type and topics for a new resource, from the site's lists.
 * It runs only when the site turns on "Fill in new items with AI". It uses the site's AI (the deploy default),
 * because a resource belongs to the site, not to one company. A failure never stops the add: the fields stay as they were.
 */

export interface FillInput {
  title: string;
  summary: string;
  text: string;
}

export interface FillOutput {
  summary: string;
  termIds: string[];
  filled: boolean;
}

function parseJson(s: string): Record<string, unknown> | null {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function aiFill(env: Env, s: Settings, terms: Term[], input: FillInput): Promise<FillOutput> {
  const none: FillOutput = { summary: input.summary, termIds: [], filled: false };
  if (!s.aiFill) return none;
  const types = terms.filter((t) => t.kind === "type" && !t.isHidden && s.lists.type.on).map((t) => t.name);
  const topics = terms.filter((t) => t.kind === "topic" && !t.isHidden && s.lists.topic.on).map((t) => t.name);
  const data = [`Title: ${input.title}`, input.summary && `Summary: ${input.summary}`, input.text && `Text: ${input.text.slice(0, 6000)}`].filter(Boolean).join("\n");
  try {
    const out = await aiText(env, null, null, {
      system: [
        "You file one resource in a resource library. Answer with JSON only, in this shape:",
        '{"summary": "two plain sentences, 40 words or fewer", "type": "one name from the types, or empty", "topics": ["up to 2 names from the topics"]}',
        `Types: ${types.join(", ") || "(none)"}`,
        `Topics: ${topics.join(", ") || "(none)"}`,
        "Use only names from these lists. Write the summary in plain, simple English.",
        UNTRUSTED_TEXT_RULE,
        "The resource:",
        untrustedText(data, "web")
      ].join("\n"),
      messages: [{ role: "user", content: "File this resource." }],
      maxTokens: 300
    });
    const j = parseJson(out.text);
    if (!j) return none;
    const byName = (kind: "type" | "topic", name: unknown) =>
      typeof name === "string" ? terms.find((t) => t.kind === kind && !t.isHidden && t.name.toLowerCase() === name.trim().toLowerCase())?.id : undefined;
    const ids = [byName("type", j.type), ...(Array.isArray(j.topics) ? j.topics.slice(0, 2).map((n) => byName("topic", n)) : [])].filter((x): x is string => !!x);
    const summary = typeof j.summary === "string" && j.summary.trim() ? j.summary.trim().slice(0, 600) : input.summary;
    return { summary, termIds: [...new Set(ids)], filled: true };
  } catch (err) {
    console.error(`[library] AI fill failed: ${(err as Error).message}`);
    return none;
  }
}
