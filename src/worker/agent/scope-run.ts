import type { Env } from "../env";
import { agentProvider, runModel } from "./model";
import { devScriptedScope, parseScopeDecision, scopePrompt, type ScopeDecision, type ScopeInput } from "./scope";
import { DEFAULT_JEV_MODEL, buildJevRequest, decideScope, type JevAnswers } from "./scope-jev";

/*
 * Runs the scope check with the best decider that is set up:
 *   1. Jev (TypeSafe), when the TYPESAFE_API_KEY secret is set. Typed answers, fast and low cost.
 *   2. dev-scripted, for local tests without AI.
 *   3. A small language model through AI Gateway (AI_SCOPE_MODEL).
 * Any failure passes the request to the agent. A failed check never blocks work.
 */

export interface ScopeResult {
  decision: ScopeDecision;
  /** What decided, for the activity log: a versioned Jev model, "llm", "dev-scripted" or "failed". */
  decider: string;
}

const PASS: ScopeDecision = { route: "project", topic: "" };
const JEV_TIMEOUT_MS = 3000;

export function scopeDecider(env: Env): "jev" | "dev-scripted" | "llm" {
  if ((env.TYPESAFE_API_KEY || "").trim()) return "jev";
  return agentProvider(env) === "dev-scripted" ? "dev-scripted" : "llm";
}

async function runJev(env: Env, input: ScopeInput): Promise<ScopeResult> {
  const base = (env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").replace(/\/+$/, "");
  const { request, options } = buildJevRequest(input, (env.TYPESAFE_MODEL || "").trim() || DEFAULT_JEV_MODEL);
  const res = await fetch(`${base}/v1/systemone`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS)
  });
  const requestId = res.headers.get("x-typesafe-request-id") ?? "none";
  if (!res.ok) {
    // An error is not an answer. Never read a failed call as "no".
    throw new Error(`TypeSafe returned ${res.status} (request ${requestId}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const body = (await res.json()) as { model?: string; answers?: JevAnswers };
  if (!body.answers || typeof body.answers !== "object") throw new Error(`TypeSafe returned no answers (request ${requestId}).`);
  return { decision: decideScope(body.answers, options), decider: body.model || request.model };
}

async function runLlm(env: Env, input: ScopeInput): Promise<ScopeResult> {
  const out = await runModel(env, scopePrompt(input), [], 120, "scope");
  return { decision: parseScopeDecision(out.text, input.otherProjects), decider: "llm" };
}

export async function checkScope(env: Env, input: ScopeInput): Promise<ScopeResult> {
  const kind = scopeDecider(env);
  if (kind === "dev-scripted") return { decision: devScriptedScope(input.message, input.otherProjects), decider: "dev-scripted" };
  try {
    return kind === "jev" ? await runJev(env, input) : await runLlm(env, input);
  } catch (err) {
    console.warn("[openact] The scope check failed, so the request went to the agent:", err);
    return { decision: PASS, decider: "failed" };
  }
}
