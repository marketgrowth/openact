import { HttpError, companyAi, type Env } from "@openact/core/server";

/*
 * Streams text from the company's AI for Docs writing help.
 * It uses the same AI as the rest of OpenAct: the company's own provider and key when an owner set one,
 * or the deploy default from AI_PROVIDER. Every provider goes through Cloudflare AI Gateway.
 * AI_PROVIDER=dev-scripted returns a fixed answer, so local tests never call a real provider.
 */

const DEFAULT_MODELS: Record<string, string> = {
  "workers-ai": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-4.1-mini"
};

export interface AiSetup {
  provider: string;
  model: string;
  apiKey: string;
  source: "company" | "deploy";
}

function deployProvider(env: Env): string {
  const p = (env.AI_PROVIDER || "workers-ai").trim().toLowerCase();
  return p === "dev-scripted" || p in DEFAULT_MODELS ? p : "workers-ai";
}

function deployModel(env: Env, provider: string): string {
  const m = (env.AI_MODEL || "").trim();
  const fallback = DEFAULT_MODELS[provider] ?? "";
  if (!m || (provider !== "workers-ai" && m.startsWith("@cf/")) || (provider === "workers-ai" && !m.startsWith("@cf/") && !m.startsWith("@hf/")))
    return fallback;
  return m;
}

export async function aiSetup(env: Env, companyId: string): Promise<AiSetup> {
  const deploy = deployProvider(env);
  if (deploy === "dev-scripted") return { provider: deploy, model: "", apiKey: "", source: "deploy" };
  const own = await companyAi(env, companyId);
  if (own) return { provider: own.provider, model: own.model, apiKey: own.apiKey, source: "company" };
  const apiKey = deploy === "anthropic" ? env.ANTHROPIC_API_KEY || "" : deploy === "openai" ? env.OPENAI_API_KEY || "" : "";
  return { provider: deploy, model: deployModel(env, deploy), apiKey, source: "deploy" };
}

function gatewayUrl(env: Env, path: string): string {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_ID) throw new HttpError(500, "Set CF_ACCOUNT_ID and AI_GATEWAY_ID to use this AI provider through AI Gateway.");
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/${path}`;
}

const gatewayAuth = (env: Env): Record<string, string> => (env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {});

function missingKey(setup: AiSetup, secret: string): HttpError {
  return new HttpError(
    500,
    setup.source === "company"
      ? "Your company's AI key is missing. A company owner can add it in Company settings, on the AI provider tab."
      : `Set the ${secret} secret to use this AI provider. Or a company owner can add their own key in Company settings, on the AI provider tab.`
  );
}

async function failed(res: Response, setup: AiSetup): Promise<HttpError> {
  // Log the status and a short part of the body. The body never holds the key or the doc text.
  console.error(`[openact] docs AI provider returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  if (setup.source === "company" && (res.status === 401 || res.status === 403))
    return new HttpError(
      502,
      "The AI provider did not accept your company's API key. A company owner can check it in Company settings, on the AI provider tab."
    );
  if (res.status === 429) return new HttpError(429, "The AI provider is busy. Try again in a minute.");
  return new HttpError(502, "The AI service did not answer. Try again in a minute.");
}

/** Reads server-sent events and yields the data of each event. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith("data:")) yield buf.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

async function* pick(body: ReadableStream<Uint8Array>, get: (j: any) => string | undefined): AsyncGenerator<string> {
  for await (const data of sseData(body)) {
    if (!data || data === "[DONE]") continue;
    try {
      const t = get(JSON.parse(data));
      if (t) yield t;
    } catch {
      /* A line that is not JSON, such as a keep-alive. */
    }
  }
}

async function* scripted(text: string): AsyncGenerator<string> {
  for (const part of text.match(/.{1,24}/gs) ?? []) yield part;
}

/**
 * Starts a streamed answer. Errors before the first word (a missing key, a refused request) throw HttpError,
 * so the route can answer with a plain error. The stream then yields text as it arrives.
 */
export async function startAiStream(
  env: Env,
  setup: AiSetup,
  prompt: { system: string; user: string },
  devAnswer: string,
  maxTokens = 4096
): Promise<AsyncIterable<string>> {
  const p = setup.provider;
  if (p === "dev-scripted") return scripted(devAnswer);

  if (p === "anthropic") {
    if (!setup.apiKey) throw missingKey(setup, "ANTHROPIC_API_KEY");
    const res = await fetch(gatewayUrl(env, "anthropic/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": setup.apiKey, "anthropic-version": "2023-06-01", ...gatewayAuth(env) },
      body: JSON.stringify({
        model: setup.model,
        max_tokens: maxTokens,
        stream: true,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }]
      })
    });
    if (!res.ok || !res.body) throw await failed(res, setup);
    return pick(res.body, (j) => (j.type === "content_block_delta" && j.delta?.type === "text_delta" ? j.delta.text : undefined));
  }

  if (p === "openai") {
    if (!setup.apiKey) throw missingKey(setup, "OPENAI_API_KEY");
    const res = await fetch(gatewayUrl(env, "openai/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${setup.apiKey}`, ...gatewayAuth(env) },
      body: JSON.stringify({
        model: setup.model,
        max_tokens: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      })
    });
    if (!res.ok || !res.body) throw await failed(res, setup);
    return pick(res.body, (j) => j.choices?.[0]?.delta?.content);
  }

  // Workers AI through the binding, with AI Gateway when AI_GATEWAY_ID is set.
  const gatewayId = (env.AI_GATEWAY_ID || "").trim();
  const input = {
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ],
    max_tokens: maxTokens,
    stream: true
  };
  try {
    const out = (await env.AI.run(
      setup.model as Parameters<Ai["run"]>[0],
      input as never,
      gatewayId ? ({ gateway: { id: gatewayId } } as never) : undefined
    )) as unknown;
    if (!(out instanceof ReadableStream)) throw new Error("Workers AI did not return a stream.");
    return pick(out as ReadableStream<Uint8Array>, (j) => j.response);
  } catch (err) {
    if (/run remotely/i.test(String(err)))
      throw new HttpError(
        503,
        "AI needs a connection to Cloudflare. For local development, run `npx wrangler login`, then `npm run dev:ai`. Or set AI_PROVIDER to dev-scripted to test without AI."
      );
    console.error("[openact] docs Workers AI failed:", err);
    throw new HttpError(502, "The AI service did not answer. Try again in a minute.");
  }
}
