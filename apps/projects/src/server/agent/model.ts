import type { Env } from "../env";
import { HttpError, aiOverride, companyServiceKey } from "../util";
import {
  parseProvider,
  parseWorkersAi,
  providerRequest,
  runDevScripted,
  toWorkersAi,
  type AgentMsg,
  type ModelOutput,
  type ToolDef
} from "./messages";

/*
 * One model turn with tool calling. Every provider goes through Cloudflare AI Gateway.
 * The deploy default comes from AI_PROVIDER: workers-ai (default), anthropic, openai, or dev-scripted (local tests only).
 * A company owner can replace it with their own provider, model and API key in Company settings, under AI provider.
 * Each person can replace both with their own key in Personal account, under My AI, when the company allows it.
 */

const DEFAULT_MODELS: Record<string, string> = {
  "workers-ai": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  anthropic: "claude-haiku-5-5",
  // The OpenAI path uses the Responses API with encrypted reasoning, so the default is a tested GPT-6 model.
  openai: "gpt-6.2-sol"
};

/** Small, fast models for the scope check. Set AI_SCOPE_MODEL to choose another. */
const SCOPE_MODELS: Record<string, string> = {
  "workers-ai": "@cf/meta/llama-3.1-8b-instruct-fast",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-6-luna"
};

export type ModelKind = "agent" | "scope";

/** The provider, models and key for one request. Make it with aiSetup or deployAi. */
export interface AiSetup {
  provider: string;
  model: string;
  scopeModel: string;
  /** The key for anthropic, openai or google. Empty for workers-ai and dev-scripted. */
  apiKey: string;
  /** "user" for the person's own key, "company" when a company owner set the AI, "deploy" for the deploy default. */
  source: "user" | "company" | "deploy";
  /**
   * The TypeSafe key for the scope check, from companyServiceKey: the company's, its partner's or the deploy's.
   * Null when Jev is off for this company. Undefined: use the TYPESAFE_API_KEY secret, as before.
   */
  jevKey?: string | null;
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
 * The AI for one person in one company: their own key when the company allows it, then the company AI, then the deploy default.
 * dev-scripted always wins, so local tests never call a real provider.
 */
export async function aiSetup(env: Env, companyId: string | null | undefined, userId?: string | null): Promise<AiSetup> {
  if (agentProvider(env) === "dev-scripted") return deployAi(env);
  // aiOverride throws "ai_key_required" for a partner that must bring its own AI. The deploy default never runs there.
  const own = await aiOverride(env, companyId, userId);
  const jevKey = (await companyServiceKey(env, companyId, "typesafe")).key;
  if (own) return { provider: own.provider, model: own.model, scopeModel: own.scopeModel, apiKey: own.apiKey, source: own.source, jevKey };
  return { ...deployAi(env), jevKey };
}

/** Says who must add the key: the person, a company owner, or the person who runs the deploy. */
export function missingKey(setup: AiSetup, secret: string): HttpError {
  if (setup.source === "user") return new HttpError(500, "Your own AI key is missing. Add it again in Settings, under Personal account, My AI.");
  return new HttpError(
    500,
    setup.source === "company"
      ? "Your company's AI key is missing. A company owner can add it in Company settings, under AI provider."
      : `Set the ${secret} secret to use this AI provider. Or a company owner can add their own key in Company settings, under AI provider.`
  );
}

function gatewayUrl(env: Env, path: string): string {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_ID) throw new HttpError(500, "Set CF_ACCOUNT_ID and AI_GATEWAY_ID to use this AI provider through AI Gateway.");
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/${path}`;
}

const gatewayAuth = (env: Env): Record<string, string> => (env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {});

/** A clear error for a failed provider request. It says whose key failed and where to fix it. */
export async function failed(res: Response, setup: AiSetup): Promise<HttpError> {
  const body = await res.text().catch(() => "");
  console.error(`[openact] AI provider returned ${res.status}: ${body.slice(0, 500)}`);
  const rejected = res.status === 401 || res.status === 403 || (setup.provider === "google" && res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body));
  const noCredit = /credit|billing|insufficient_quota|exceeded your current quota/i.test(body);
  if (setup.source === "user" && (rejected || noCredit)) {
    return new HttpError(502, `The AI provider did not accept your own API key${noCredit ? ", because the account has no credit" : ""}. Check it in Settings, under Personal account, My AI.`);
  }
  if (setup.source === "company" && (rejected || noCredit)) {
    return new HttpError(502, "The AI provider did not accept your company's API key. A company owner can check it in Company settings, under AI provider.");
  }
  return new HttpError(502, "The AI service did not answer. Try again in a minute.");
}

export async function runModel(env: Env, setup: AiSetup, msgs: AgentMsg[], tools: ToolDef[], maxTokens = 1200, kind: ModelKind = "agent"): Promise<ModelOutput> {
  const p = setup.provider;
  if (p === "dev-scripted") return runDevScripted(msgs);
  const model = kind === "scope" ? setup.scopeModel : setup.model;

  if (p === "anthropic" || p === "openai" || p === "google") {
    if (!setup.apiKey) throw missingKey(setup, p === "anthropic" ? "ANTHROPIC_API_KEY" : p === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY");
    const req = providerRequest(p, model, setup.apiKey, msgs, tools, maxTokens);
    const res = await fetch(gatewayUrl(env, req.gatewayPath), { method: "POST", headers: { ...req.headers, ...gatewayAuth(env) }, body: JSON.stringify(req.body) });
    if (!res.ok) throw await failed(res, setup);
    return parseProvider(p, await res.json());
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
