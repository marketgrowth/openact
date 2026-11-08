import type { Env } from "../env";
import { HttpError, companyAi } from "../util";
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
 * The deploy default comes from AI_PROVIDER: workers-ai (default), anthropic, openai, or dev-scripted (local tests only).
 * A company owner can replace it with their own provider, model and API key in Company settings, on the AI provider tab.
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

/** The provider, models and key for one request. Make it with aiSetup or deployAi. */
export interface AiSetup {
  provider: string;
  model: string;
  scopeModel: string;
  /** The key for anthropic or openai. Empty for workers-ai and dev-scripted. */
  apiKey: string;
  /** "company" when a company owner set the AI, "deploy" for the deploy default. */
  source: "company" | "deploy";
}

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

/** The deploy default, from AI_PROVIDER, AI_MODEL, AI_SCOPE_MODEL and the key secrets. */
export function deployAi(env: Env): AiSetup {
  const provider = agentProvider(env);
  const apiKey = provider === "anthropic" ? env.ANTHROPIC_API_KEY || "" : provider === "openai" ? env.OPENAI_API_KEY || "" : "";
  if (provider === "dev-scripted") return { provider, model: "", scopeModel: "", apiKey: "", source: "deploy" };
  return { provider, model: modelFor(env, provider, "agent"), scopeModel: modelFor(env, provider, "scope"), apiKey, source: "deploy" };
}

/**
 * The AI for a company: the company's own setting when an owner set one, or the deploy default.
 * dev-scripted always wins, so local tests never call a real provider.
 */
export async function aiSetup(env: Env, companyId: string | null | undefined): Promise<AiSetup> {
  if (agentProvider(env) === "dev-scripted") return deployAi(env);
  const own = await companyAi(env, companyId);
  if (own) return { provider: own.provider, model: own.model, scopeModel: own.scopeModel, apiKey: own.apiKey, source: "company" };
  return deployAi(env);
}

/** Says who must add the key: a company owner for a company setting, or the person who runs the deploy. */
function missingKey(setup: AiSetup, secret: string): HttpError {
  return new HttpError(
    500,
    setup.source === "company"
      ? "Your company's AI key is missing. A company owner can add it in Company settings, on the AI provider tab."
      : `Set the ${secret} secret to use this AI provider. Or a company owner can add their own key in Company settings, on the AI provider tab.`
  );
}

function gatewayUrl(env: Env, path: string): string {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_ID) throw new HttpError(500, "Set CF_ACCOUNT_ID and AI_GATEWAY_ID to use this AI provider through AI Gateway.");
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/${path}`;
}

const gatewayAuth = (env: Env): Record<string, string> => (env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {});

async function failed(res: Response, setup: AiSetup): Promise<HttpError> {
  console.error(`[openact] AI provider returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
  if (setup.source === "company" && (res.status === 401 || res.status === 403)) {
    return new HttpError(502, "The AI provider did not accept your company's API key. A company owner can check it in Company settings, on the AI provider tab.");
  }
  return new HttpError(502, "The AI service did not answer. Try again in a minute.");
}

export async function runModel(env: Env, setup: AiSetup, msgs: AgentMsg[], tools: ToolDef[], maxTokens = 1200, kind: ModelKind = "agent"): Promise<ModelOutput> {
  const p = setup.provider;
  if (p === "dev-scripted") return runDevScripted(msgs);
  const model = kind === "scope" ? setup.scopeModel : setup.model;

  if (p === "anthropic") {
    if (!setup.apiKey) throw missingKey(setup, "ANTHROPIC_API_KEY");
    const body = toAnthropic(msgs, tools);
    const res = await fetch(gatewayUrl(env, "anthropic/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": setup.apiKey, "anthropic-version": "2023-06-01", ...gatewayAuth(env) },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: body.system, messages: body.messages, ...(tools.length ? { tools: body.tools } : {}) })
    });
    if (!res.ok) throw await failed(res, setup);
    return parseAnthropic(await res.json());
  }

  if (p === "openai") {
    if (!setup.apiKey) throw missingKey(setup, "OPENAI_API_KEY");
    const body = toOpenAi(msgs, tools);
    const res = await fetch(gatewayUrl(env, "openai/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${setup.apiKey}`, ...gatewayAuth(env) },
      body: JSON.stringify({ model, messages: body.messages, max_tokens: maxTokens, ...(tools.length ? { tools: body.tools } : {}) })
    });
    if (!res.ok) throw await failed(res, setup);
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
