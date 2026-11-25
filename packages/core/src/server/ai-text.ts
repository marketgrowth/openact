import type { Env } from "./env.ts";
import { aiGatewayHeaders, aiGatewayUrl, aiOverride } from "./company-ai.ts";
import { HttpError } from "./util.ts";

/*
 * One text answer from a model, with the same key rules as every OpenAct app:
 * the person's own key (when the company allows it), then the company key, then the deploy default.
 * No tools and no streaming. Apps that answer a question from their own content use this.
 * Keyed providers go through Cloudflare AI Gateway. Workers AI goes through the AI binding.
 * AI_PROVIDER=dev-scripted gives a fixed answer, so tests never call a real provider.
 */

export interface AiTextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiTextRequest {
  /** The instructions. Put any text that other people wrote inside labels, as data. */
  system: string;
  messages: AiTextMessage[];
  /** Default 800. */
  maxTokens?: number;
}

export interface AiTextResult {
  text: string;
  provider: string;
  model: string;
  /** Whose AI answered: the person's own key, the company key, or the deploy default. */
  source: "user" | "company" | "deploy";
}

/** The deploy default models. They match the Projects agent. */
const DEFAULT_MODELS: Record<string, string> = {
  "workers-ai": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-6.2-sol"
};

type Setup = { provider: string; model: string; apiKey: string; source: AiTextResult["source"] };

function deploySetup(env: Env): Setup {
  let provider = (env.AI_PROVIDER || "workers-ai").trim().toLowerCase();
  if (provider !== "dev-scripted" && !(provider in DEFAULT_MODELS)) provider = "workers-ai";
  const m = (env.AI_MODEL || "").trim();
  const cf = m.startsWith("@cf/") || m.startsWith("@hf/");
  const model = provider === "dev-scripted" ? "" : m && (provider === "workers-ai") === cf ? m : DEFAULT_MODELS[provider]!;
  const apiKey = provider === "anthropic" ? env.ANTHROPIC_API_KEY || "" : provider === "openai" ? env.OPENAI_API_KEY || "" : "";
  return { provider, model, apiKey, source: "deploy" };
}

async function setupFor(env: Env, companyId: string | null | undefined, userId: string | null | undefined): Promise<Setup> {
  const deploy = deploySetup(env);
  if (deploy.provider === "dev-scripted") return deploy;
  const own = await aiOverride(env, companyId, userId);
  return own ? { provider: own.provider, model: own.model, apiKey: own.apiKey, source: own.source } : deploy;
}

function keyError(s: Setup): HttpError {
  if (s.source === "user") return new HttpError(500, "Your own AI key is missing. Add it again in Settings, under Personal account, My AI.");
  if (s.source === "company") return new HttpError(500, "Your company's AI key is missing. A company owner can add it in Company settings, under AI provider.");
  return new HttpError(500, "This deploy has no key for its AI provider. A company owner can add their own key in Company settings, under AI provider.");
}

async function failed(res: Response, s: Setup): Promise<HttpError> {
  const body = await res.text().catch(() => "");
  console.error(`[openact] AI provider returned ${res.status}: ${body.slice(0, 500)}`);
  const rejected = res.status === 401 || res.status === 403 || (s.provider === "google" && res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body));
  const noCredit = /credit|billing|insufficient_quota|exceeded your current quota/i.test(body);
  if (s.source === "user" && (rejected || noCredit)) {
    return new HttpError(502, `The AI provider did not accept your own API key${noCredit ? ", because the account has no credit" : ""}. Check it in Settings, under Personal account, My AI.`);
  }
  if (s.source === "company" && (rejected || noCredit)) {
    return new HttpError(502, "The AI provider did not accept your company's API key. A company owner can check it in Company settings, under AI provider.");
  }
  return new HttpError(502, "The AI service did not answer. Try again in a minute.");
}

const textOf = (parts: unknown): string =>
  Array.isArray(parts)
    ? parts
        .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
        .join("")
    : "";

async function keyed(env: Env, s: Setup, req: AiTextRequest, maxTokens: number): Promise<string> {
  if (!s.apiKey) throw keyError(s);
  let path: string;
  let headers: Record<string, string>;
  let body: unknown;
  if (s.provider === "anthropic") {
    path = "anthropic/v1/messages";
    headers = { "content-type": "application/json", "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" };
    body = { model: s.model, max_tokens: maxTokens, system: req.system, messages: req.messages };
  } else if (s.provider === "openai") {
    // The Responses API. OpenAI stores nothing (store: false). Reasoning models use part of the budget to think.
    path = "openai/responses";
    headers = { "content-type": "application/json", authorization: `Bearer ${s.apiKey}` };
    body = { model: s.model, instructions: req.system, input: req.messages, max_output_tokens: maxTokens + 2000, store: false };
  } else {
    path = `google-ai-studio/v1beta/models/${encodeURIComponent(s.model)}:generateContent`;
    headers = { "content-type": "application/json", "x-goog-api-key": s.apiKey };
    body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens + 2000 }
    };
  }
  const res = await fetch(aiGatewayUrl(env, path), { method: "POST", headers: { ...headers, ...aiGatewayHeaders(env) }, body: JSON.stringify(body) });
  if (!res.ok) throw await failed(res, s);
  const data = (await res.json()) as Record<string, unknown>;
  if (s.provider === "anthropic") return textOf(data.content);
  if (s.provider === "openai") {
    if (typeof data.output_text === "string") return data.output_text;
    const out = Array.isArray(data.output) ? data.output : [];
    return out.map((o) => (o && typeof o === "object" && (o as { type?: string }).type === "message" ? textOf((o as { content?: unknown }).content) : "")).join("");
  }
  const cands = Array.isArray(data.candidates) ? data.candidates : [];
  return textOf((cands[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts);
}

async function workersAi(env: Env, s: Setup, req: AiTextRequest, maxTokens: number): Promise<string> {
  const input = { messages: [{ role: "system", content: req.system }, ...req.messages], max_tokens: maxTokens };
  const gatewayId = (env.AI_GATEWAY_ID || "").trim();
  const run = (withGateway: boolean) =>
    env.AI.run(s.model as Parameters<Ai["run"]>[0], input as never, withGateway && gatewayId ? ({ gateway: { id: gatewayId } } as never) : undefined);
  let out: unknown;
  try {
    try {
      out = await run(true);
    } catch (err) {
      if (!gatewayId || /run remotely/i.test(String(err))) throw err;
      console.warn(`[openact] AI Gateway "${gatewayId}" failed, so the request ran without it:`, err);
      out = await run(false);
    }
  } catch (err) {
    if (/run remotely/i.test(String(err))) {
      throw new HttpError(503, "AI needs a connection to Cloudflare. For local development, run `npx wrangler login`, then `npm run dev:ai`. Or set AI_PROVIDER to dev-scripted.");
    }
    console.error("[openact] Workers AI failed:", err);
    throw new HttpError(502, "The AI service did not answer. Try again in a minute.");
  }
  if (typeof out === "string") return out;
  const o = (out ?? {}) as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof o.response === "string") return o.response;
  const c = o.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : "";
}

/**
 * Asks the model for one text answer, as this person in this company.
 * Check the person's access and your app's permission first. The result says whose AI answered, for the label in the web app.
 */
export async function aiText(env: Env, companyId: string | null | undefined, userId: string | null | undefined, req: AiTextRequest): Promise<AiTextResult> {
  const s = await setupFor(env, companyId, userId);
  const maxTokens = Math.max(64, Math.min(req.maxTokens ?? 800, 4000));
  let text: string;
  if (s.provider === "dev-scripted") {
    // A fixed answer for tests. It cites the first item, so callers can test their citation handling.
    const last = req.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    text = `Dev answer for: ${last.slice(0, 120)} [1]`;
  } else if (s.provider === "anthropic" || s.provider === "openai" || s.provider === "google") {
    text = await keyed(env, s, req, maxTokens);
  } else {
    text = await workersAi(env, s, req, maxTokens);
  }
  return { text: text.trim(), provider: s.provider, model: s.model, source: s.source };
}
