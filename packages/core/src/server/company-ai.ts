import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import {
  COMPANY_AI_MODELS,
  COMPANY_AI_SCOPE_MODELS,
  cleanApiKey,
  isCompanyAiModel,
  isCompanyAiProvider,
  keyHintOf,
  type CompanyAiProvider,
  type CompanyAiSettings
} from "../shared/ai";
import { requireCompanyRole } from "./data";
import { HttpError, nowIso, readJson, requireUser } from "./util";
import { openKey, sealKey } from "./secret-box";

/*
 * The AI agent of a company: GET, PUT and DELETE /api/companies/:id/ai
 *
 * Owners and admins can see the setting. Only owners can change it, because the key bills the company.
 * The API key is encrypted with AES-GCM before it goes into D1. It never goes back to the web app.
 * The encryption key comes from AUTH_SECRET. The company id is bound to each saved key,
 * so a key copied to another company's row does not decrypt.
 */

/** What apps get for a company that set its own AI. */
export interface CompanyAiOverride {
  provider: CompanyAiProvider;
  model: string;
  scopeModel: string;
  apiKey: string;
}

/** Where the AI setting of a company comes from, without the key. For labels in the web app. */
export interface CompanyAiChoice {
  provider: string;
  model: string;
  source: "company" | "deploy";
}

type Row = { provider: string; model: string; key_cipher: string; key_hint: string };

/** The secret that protects saved keys. Only a localhost APP_URL may run without AUTH_SECRET. */
function keySecret(env: Env): string | null {
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) return env.AUTH_SECRET;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test((env.APP_URL || "").trim())) return "openact-local-development-only";
  return null;
}

async function readRow(env: Env, companyId: string): Promise<Row | null> {
  try {
    return await env.DB.prepare("SELECT provider, model, key_cipher, key_hint FROM company_ai WHERE company_id = ?").bind(companyId).first<Row>();
  } catch (e) {
    // Before migration 0007 runs, every company uses the deploy default.
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
}

/**
 * The AI that a company set, with its decrypted key, or null for the deploy default.
 * A key that does not decrypt also gives null, and a warning in the logs.
 */
export async function companyAi(env: Env, companyId: string | null | undefined): Promise<CompanyAiOverride | null> {
  if (!companyId) return null;
  const row = await readRow(env, companyId);
  if (!row || !isCompanyAiProvider(row.provider)) return null;
  const secret = keySecret(env);
  const apiKey = secret ? await openKey(secret, companyId, row.key_cipher) : null;
  if (!apiKey) {
    console.warn(`[openact] The saved AI key of company ${companyId} does not decrypt, so the deploy default runs. A company owner must save the key again.`);
    return null;
  }
  return { provider: row.provider, model: row.model, scopeModel: COMPANY_AI_SCOPE_MODELS[row.provider], apiKey };
}

/** The deploy default provider and model, from AI_PROVIDER and AI_MODEL. */
export function deployAiDefault(env: Env): { provider: string; model: string } {
  const provider = (env.AI_PROVIDER || "workers-ai").trim().toLowerCase() || "workers-ai";
  return { provider, model: (env.AI_MODEL || "").trim() };
}

/** The provider and model a company uses, without the key. It does not check that the key decrypts. */
export async function companyAiChoice(env: Env, companyId: string | null | undefined): Promise<CompanyAiChoice> {
  const row = companyId ? await readRow(env, companyId) : null;
  if (row && isCompanyAiProvider(row.provider)) return { provider: row.provider, model: row.model, source: "company" };
  return { ...deployAiDefault(env), source: "deploy" };
}

/** The AI Gateway URL for a provider path, such as "anthropic/v1/messages". */
export function aiGatewayUrl(env: Env, path: string): string {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_ID) {
    throw new HttpError(400, "This deploy has no AI Gateway. Ask the person who runs it to set CF_ACCOUNT_ID and AI_GATEWAY_ID.");
  }
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/${path}`;
}

export const aiGatewayHeaders = (env: Env): Record<string, string> => (env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {});

/** Sends one very short request with the key, so a wrong key or model fails now and not in the agent. */
async function checkKey(env: Env, provider: CompanyAiProvider, model: string, key: string): Promise<void> {
  if (provider !== "anthropic") return;
  let res: Response;
  try {
    res = await fetch(aiGatewayUrl(env, "anthropic/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...aiGatewayHeaders(env) },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Reply with OK." }] }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "Anthropic did not answer the test request. Try again in a minute.");
  }
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  // Log the status and the error type only. The body never holds the key.
  console.warn(`[openact] The Anthropic key test returned ${res.status}: ${body.slice(0, 200)}`);
  if (res.status === 401) throw new HttpError(400, "Anthropic did not accept this API key. Check the key, or make a new one at console.anthropic.com.");
  if (res.status === 403) throw new HttpError(400, "This API key has no permission to use the model. Check the key's workspace in console.anthropic.com.");
  if (res.status === 404 || (res.status === 400 && /model/i.test(body))) throw new HttpError(400, "This API key cannot use the model you chose. Choose another model.");
  if (res.status === 400 && /credit|billing/i.test(body)) throw new HttpError(400, "The Anthropic account of this key has no credit. Add credit at console.anthropic.com, then try again.");
  if (res.status === 429) throw new HttpError(429, "Anthropic is limiting requests for this key. Try again in a minute.");
  throw new HttpError(502, `Anthropic did not answer the test request (status ${res.status}). Try again in a minute.`);
}

async function settings(env: Env, companyId: string, canEdit: boolean): Promise<CompanyAiSettings> {
  const row = await readRow(env, companyId);
  const deployDefault = deployAiDefault(env);
  if (!row || !isCompanyAiProvider(row.provider)) return { provider: "default", model: null, keyHint: null, keyBroken: false, deployDefault, canEdit };
  const secret = keySecret(env);
  const broken = !secret || !(await openKey(secret, companyId, row.key_cipher));
  return { provider: row.provider, model: row.model, keyHint: row.key_hint, keyBroken: broken, deployDefault, canEdit };
}

export const companyAiRoutes = new Hono<AppEnv>();

companyAiRoutes.get("/:id/ai", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  return c.json(await settings(c.env, id, role === "owner"));
});

companyAiRoutes.put("/:id/ai", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const body = await readJson(c);
  if (!isCompanyAiProvider(body.provider)) throw new HttpError(400, "Choose an AI provider.");
  const provider = body.provider;
  const model = body.model === undefined || body.model === null || body.model === "" ? COMPANY_AI_MODELS[provider][0].id : body.model;
  if (!isCompanyAiModel(provider, model)) throw new HttpError(400, "Choose a model from the list.");

  const secret = keySecret(c.env);
  if (!secret) throw new HttpError(500, "The server is missing AUTH_SECRET, so it cannot protect the key. Ask the person who runs this deploy to set it.");

  // An empty key keeps the saved key, if it is for the same provider and still decrypts.
  let key: string;
  if (body.apiKey === undefined || body.apiKey === null || body.apiKey === "") {
    const row = await readRow(c.env, id);
    const saved = row && row.provider === provider ? await openKey(secret, id, row.key_cipher) : null;
    if (!saved) throw new HttpError(400, "Paste the API key.");
    key = saved;
  } else {
    const r = cleanApiKey(provider, body.apiKey);
    if ("problem" in r) throw new HttpError(400, r.problem);
    key = r.key;
  }

  await checkKey(c.env, provider, model, key);

  const sealed = await sealKey(secret, id, key);
  const iso = nowIso();
  try {
    await c.env.DB.prepare(
      `INSERT INTO company_ai (company_id, provider, model, key_cipher, key_hint, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, key_cipher = excluded.key_cipher,
         key_hint = excluded.key_hint, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(id, provider, model, sealed, keyHintOf(key), user.id, iso)
      .run();
  } catch (e) {
    if (/no such table/i.test(String(e))) throw new HttpError(503, "The company AI table is missing. Run the database migrations, then try again.");
    throw e;
  }
  return c.json(await settings(c.env, id, true));
});

/** Removes the company's AI setting and its key. The company goes back to the deploy default. */
companyAiRoutes.delete("/:id/ai", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  try {
    await c.env.DB.prepare("DELETE FROM company_ai WHERE company_id = ?").bind(id).run();
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  }
  return c.json(await settings(c.env, id, true));
});
