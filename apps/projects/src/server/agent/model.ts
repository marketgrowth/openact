import type { Env } from "../env";
import { HttpError } from "../util";
import {
  parseAnthropic,
  parseOpenAi,
  parseWorkersAi,
  runDevScripted,
  toAnthropic,
  toOpenAi,
  toWorkersAi,
  type AgentMsg,
  type ModelOutput,
  type ToolDef
} from "./messages";

/*
 * One model turn with tool calling. Every provider goes through Cloudflare AI Gateway.
 * AI_PROVIDER: workers-ai (default), anthropic, openai, or dev-scripted (local tests only).
 */

const DEFAULT_MODELS: Record<string, string> = {
  "workers-ai": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-4.1-mini"
};

/** Small, fast models for the scope check. Set AI_SCOPE_MODEL to choose another. */
const SCOPE_MODELS: Record<string, string> = {
  "workers-ai": "@cf/meta/llama-3.1-8b-instruct-fast",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-4.1-mini"
};

export type ModelKind = "agent" | "scope";

export function agentProvider(env: Env): string {
  const p = (env.AI_PROVIDER || "workers-ai").trim().toLowerCase();
  return p === "dev-scripted" || p in DEFAULT_MODELS ? p : "workers-ai";
}

function modelFor(env: Env, p: string, kind: ModelKind): string {
  const m = ((kind === "scope" ? env.AI_SCOPE_MODEL : env.AI_MODEL) || "").trim();
  const fallback = (kind === "scope" ? SCOPE_MODELS : DEFAULT_MODELS)[p];
  if (!m || (p !== "workers-ai" && m.startsWith("@cf/")) || (p === "workers-ai" && !m.startsWith("@cf/") && !m.startsWith("@hf/"))) return fallback;
  return m;
}

function gatewayUrl(env: Env, path: string): string {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_ID) throw new HttpError(500, "Set CF_ACCOUNT_ID and AI_GATEWAY_ID to use this AI provider through AI Gateway.");
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/${path}`;
}

const gatewayAuth = (env: Env): Record<string, string> => (env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {});

async function failed(res: Response): Promise<HttpError> {
  console.error(`[openact] AI provider returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
  return new HttpError(502, "The AI service did not answer. Try again in a minute.");
}

export async function runModel(env: Env, msgs: AgentMsg[], tools: ToolDef[], maxTokens = 1200, kind: ModelKind = "agent"): Promise<ModelOutput> {
  const p = agentProvider(env);
  if (p === "dev-scripted") return runDevScripted(msgs);
  const model = modelFor(env, p, kind);

  if (p === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(500, "Set the ANTHROPIC_API_KEY secret to use Anthropic models.");
    const body = toAnthropic(msgs, tools);
    const res = await fetch(gatewayUrl(env, "anthropic/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", ...gatewayAuth(env) },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: body.system, messages: body.messages, ...(tools.length ? { tools: body.tools } : {}) })
    });
    if (!res.ok) throw await failed(res);
    return parseAnthropic(await res.json());
  }

  if (p === "openai") {
    if (!env.OPENAI_API_KEY) throw new HttpError(500, "Set the OPENAI_API_KEY secret to use OpenAI models.");
    const body = toOpenAi(msgs, tools);
    const res = await fetch(gatewayUrl(env, "openai/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}`, ...gatewayAuth(env) },
      body: JSON.stringify({ model, messages: body.messages, max_tokens: maxTokens, ...(tools.length ? { tools: body.tools } : {}) })
    });
    if (!res.ok) throw await failed(res);
    return parseOpenAi(await res.json());
  }

  // Workers AI through the binding, with AI Gateway when AI_GATEWAY_ID is set.
  const body = toWorkersAi(msgs, tools);
  const input = { messages: body.messages, max_tokens: maxTokens, ...(tools.length ? { tools: body.tools } : {}) };
  const gatewayId = (env.AI_GATEWAY_ID || "").trim();
  const run = (withGateway: boolean) =>
    env.AI.run(model as Parameters<Ai["run"]>[0], input as never, withGateway && gatewayId ? ({ gateway: { id: gatewayId } } as never) : undefined);
  try {
    try {
      return parseWorkersAi(await run(true));
    } catch (err) {
      if (!gatewayId || /run remotely/i.test(String(err))) throw err;
      console.warn(`[openact] AI Gateway "${gatewayId}" failed, so the request ran without it:`, err);
      return parseWorkersAi(await run(false));
    }
  } catch (err) {
    if (/run remotely/i.test(String(err))) {
      throw new HttpError(503, "AI needs a connection to Cloudflare. For local development, run `npx wrangler login`, then `npm run dev:ai`. Or set AI_PROVIDER to dev-scripted to test without AI.");
    }
    console.error("[openact] Workers AI failed:", err);
    throw new HttpError(502, "The AI service did not answer. Try again in a minute.");
  }
}
