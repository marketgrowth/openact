import { Hono } from "hono";
import type { AppEnv, Env } from "./env.ts";
import {
  COMPANY_AI_MODELS,
  COMPANY_AI_PROVIDER_LABELS,
  COMPANY_AI_SCOPE_MODELS,
  cleanApiKey,
  isCompanyAiModel,
  isCompanyAiProvider,
  keyHintOf,
  type CompanyAiProvider,
  type CompanyAiSettings,
  type UserAiSettings
} from "../shared/ai.ts";
import { requireCompanyRole } from "./data.ts";
import { HttpError, nowIso, readJson, requireUser } from "./util.ts";
import { openKey, sealKey } from "./secret-box.ts";

/*
 * Bring your own AI.
 *
 * Company AI: GET, PUT and DELETE /api/companies/:id/ai, and PUT /api/companies/:id/ai/member-keys.
 *   Owners and admins can see the setting. Only owners can change it, because the key bills the company.
 * Personal AI: GET, PUT and DELETE /api/me/ai. Each person sets their own. Their key bills them.
 *
 * Order for each request: the person's own AI (when their company allows member keys), then the company AI,
 * then the deploy default. Apps get the result from aiOverride().
 *
 * API keys are encrypted with AES-GCM before they go into D1. They never go back to the web app.
 * The encryption key comes from AUTH_SECRET. A company key is bound to the company id, and a personal key
 * to the user id with its own purpose, so a key copied to another row does not decrypt.
 */

/** The AI a company or a person set, with the decrypted key. */
export interface CompanyAiOverride {
  provider: CompanyAiProvider;
  model: string;
  scopeModel: string;
  apiKey: string;
  /** Whose key it is. */
  source: "user" | "company";
}

/** Where the AI of a request comes from, without the key. For labels in the web app. */
export interface CompanyAiChoice {
  provider: string;
  model: string;
  source: "user" | "company" | "deploy";
}

type Row = { provider: string; model: string; key_cipher: string; key_hint: string };

const USER_PURPOSE = { salt: "openact/user-ai", info: "api-key v1" };

/** The secret that protects saved keys. Only a localhost APP_URL may run without AUTH_SECRET. */
function keySecret(env: Env): string | null {
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) return env.AUTH_SECRET;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test((env.APP_URL || "").trim())) return "openact-local-development-only";
  return null;
}

const noTable = (e: unknown) => /no such (table|column)/i.test(String(e));

async function readCompanyRow(env: Env, companyId: string): Promise<Row | null> {
  try {
    return await env.DB.prepare("SELECT provider, model, key_cipher, key_hint FROM company_ai WHERE company_id = ?").bind(companyId).first<Row>();
  } catch (e) {
    // Before migration 0007 runs, every company uses the deploy default.
    if (noTable(e)) return null;
    throw e;
  }
}

async function readUserRow(env: Env, userId: string): Promise<Row | null> {
  try {
    return await env.DB.prepare("SELECT provider, model, key_cipher, key_hint FROM user_ai WHERE user_id = ?").bind(userId).first<Row>();
  } catch (e) {
    // Before migration 0011 runs, nobody has a personal key.
    if (noTable(e)) return null;
    throw e;
  }
}

/** True when members of the company can use their own AI key. On by default, and for people outside a company. */
export async function companyAllowsMemberKeys(env: Env, companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return true;
  try {
    const row = await env.DB.prepare("SELECT ai_member_keys FROM companies WHERE id = ?").bind(companyId).first<{ ai_member_keys: number }>();
    return row?.ai_member_keys !== 0;
  } catch (e) {
    if (noTable(e)) return true;
    throw e;
  }
}

async function openCompanyKey(env: Env, companyId: string, row: Row): Promise<string | null> {
  const secret = keySecret(env);
  return secret ? openKey(secret, companyId, row.key_cipher) : null;
}

async function openUserKey(env: Env, userId: string, row: Row): Promise<string | null> {
  const secret = keySecret(env);
  return secret ? openKey(secret, userId, row.key_cipher, USER_PURPOSE) : null;
}

/**
 * The AI that a company set, with its decrypted key, or null for the deploy default.
 * A key that does not decrypt also gives null, and a warning in the logs.
 */
export async function companyAi(env: Env, companyId: string | null | undefined): Promise<CompanyAiOverride | null> {
  if (!companyId) return null;
  const row = await readCompanyRow(env, companyId);
  if (!row || !isCompanyAiProvider(row.provider)) return null;
  const apiKey = await openCompanyKey(env, companyId, row);
  if (!apiKey) {
    console.warn(`[openact] The saved AI key of company ${companyId} does not decrypt, so the deploy default runs. A company owner must save the key again.`);
    return null;
  }
  return { provider: row.provider, model: row.model, scopeModel: COMPANY_AI_SCOPE_MODELS[row.provider], apiKey, source: "company" };
}

/** A person's own AI, with the decrypted key, or null. It does not check the company rule. Use aiOverride for requests. */
export async function userAi(env: Env, userId: string | null | undefined): Promise<CompanyAiOverride | null> {
  if (!userId) return null;
  const row = await readUserRow(env, userId);
  if (!row || !isCompanyAiProvider(row.provider)) return null;
  const apiKey = await openUserKey(env, userId, row);
  if (!apiKey) {
    console.warn(`[openact] The saved personal AI key of user ${userId} does not decrypt, so it is skipped. The person must save the key again.`);
    return null;
  }
  return { provider: row.provider, model: row.model, scopeModel: COMPANY_AI_SCOPE_MODELS[row.provider], apiKey, source: "user" };
}

/**
 * The AI for one request: the person's own AI when the company allows it, then the company AI, or null for the deploy default.
 * Every app that calls a model should use this, so the rules are the same everywhere.
 */
export async function aiOverride(env: Env, companyId: string | null | undefined, userId: string | null | undefined): Promise<CompanyAiOverride | null> {
  if (userId && (await companyAllowsMemberKeys(env, companyId))) {
    const own = await userAi(env, userId);
    if (own) return own;
  }
  return companyAi(env, companyId);
}

/** The deploy default provider and model, from AI_PROVIDER and AI_MODEL. */
export function deployAiDefault(env: Env): { provider: string; model: string } {
  const provider = (env.AI_PROVIDER || "workers-ai").trim().toLowerCase() || "workers-ai";
  return { provider, model: (env.AI_MODEL || "").trim() };
}

/** The provider and model a request uses, without the key. It does not check that the key decrypts. */
export async function companyAiChoice(env: Env, companyId: string | null | undefined, userId?: string | null): Promise<CompanyAiChoice> {
  if (userId && (await companyAllowsMemberKeys(env, companyId))) {
    const row = await readUserRow(env, userId);
    if (row && isCompanyAiProvider(row.provider)) return { provider: row.provider, model: row.model, source: "user" };
  }
  const row = companyId ? await readCompanyRow(env, companyId) : null;
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

/** The request that tests a key: the smallest call that proves the key can use the model. */
function testRequest(env: Env, provider: CompanyAiProvider, model: string, key: string): { url: string; init: RequestInit } {
  const json = { "content-type": "application/json", ...aiGatewayHeaders(env) };
  if (provider === "anthropic") {
    return {
      url: aiGatewayUrl(env, "anthropic/v1/messages"),
      init: {
        method: "POST",
        headers: { ...json, "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Reply with OK." }] })
      }
    };
  }
  if (provider === "openai") {
    // 16 is the smallest max_output_tokens the Responses API takes. A reply cut short still proves the key.
    return {
      url: aiGatewayUrl(env, "openai/responses"),
      init: { method: "POST", headers: { ...json, authorization: `Bearer ${key}` }, body: JSON.stringify({ model, input: "Reply with OK.", max_output_tokens: 16, store: false }) }
    };
  }
  return {
    url: aiGatewayUrl(env, `google-ai-studio/v1beta/models/${encodeURIComponent(model)}:generateContent`),
    init: {
      method: "POST",
      headers: { ...json, "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }], generationConfig: { maxOutputTokens: 16 } })
    }
  };
}

/** Sends one very short request with the key, so a wrong key or model fails now and not in the agent. */
export async function checkAiKey(env: Env, provider: CompanyAiProvider, model: string, key: string): Promise<void> {
  const name = COMPANY_AI_PROVIDER_LABELS[provider].replace(/^.*\((.*)\)$/, "$1");
  const { url, init } = testRequest(env, provider, model, key);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `${name} did not answer the test request. Try again in a minute.`);
  }
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  // Log the status and the start of the error. Provider errors never hold the key.
  console.warn(`[openact] The ${name} key test returned ${res.status}: ${body.slice(0, 200)}`);
  const badKey = res.status === 401 || (provider === "google" && res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body));
  if (badKey) throw new HttpError(400, `${name} did not accept this API key. Check the key, or make a new one.`);
  if (/credit|billing|insufficient_quota|exceeded your current quota/i.test(body)) {
    throw new HttpError(400, `The ${name} account of this key has no credit or billing set up. Add it with ${name}, then try again.`);
  }
  if (res.status === 403) throw new HttpError(400, `This API key has no permission to use the model. Check the key's project or workspace with ${name}.`);
  if (res.status === 404 || (res.status === 400 && /model/i.test(body))) throw new HttpError(400, "This API key cannot use the model you chose. Choose another model.");
  if (res.status === 429) throw new HttpError(429, `${name} is limiting requests for this key. Try again in a minute.`);
  throw new HttpError(502, `${name} did not answer the test request (status ${res.status}). Try again in a minute.`);
}

/** Reads provider, model and key from a PUT body. An empty key keeps the saved key for the same provider. */
async function readChoice(body: Record<string, unknown>, saved: () => Promise<{ provider: string; key: string | null } | null>) {
  if (!isCompanyAiProvider(body.provider)) throw new HttpError(400, "Choose an AI provider.");
  const provider = body.provider;
  const model = body.model === undefined || body.model === null || body.model === "" ? COMPANY_AI_MODELS[provider][0].id : body.model;
  if (!isCompanyAiModel(provider, model)) throw new HttpError(400, "Choose a model from the list.");
  let key: string;
  if (body.apiKey === undefined || body.apiKey === null || body.apiKey === "") {
    const s = await saved();
    if (!s || s.provider !== provider || !s.key) throw new HttpError(400, "Paste the API key.");
    key = s.key;
  } else {
    const r = cleanApiKey(provider, body.apiKey);
    if ("problem" in r) throw new HttpError(400, r.problem);
    key = r.key;
  }
  return { provider, model, key };
}

function requireSecret(env: Env): string {
  const secret = keySecret(env);
  if (!secret) throw new HttpError(500, "The server is missing AUTH_SECRET, so it cannot protect the key. Ask the person who runs this deploy to set it.");
  return secret;
}

/* Company AI */

async function companySettings(env: Env, companyId: string, canEdit: boolean): Promise<CompanyAiSettings> {
  const row = await readCompanyRow(env, companyId);
  const deployDefault = deployAiDefault(env);
  const memberKeys = await companyAllowsMemberKeys(env, companyId);
  if (!row || !isCompanyAiProvider(row.provider)) return { provider: "default", model: null, keyHint: null, keyBroken: false, deployDefault, memberKeys, canEdit };
  const broken = !(await openCompanyKey(env, companyId, row));
  return { provider: row.provider, model: row.model, keyHint: row.key_hint, keyBroken: broken, deployDefault, memberKeys, canEdit };
}

export const companyAiRoutes = new Hono<AppEnv>();

companyAiRoutes.get("/:id/ai", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  return c.json(await companySettings(c.env, id, role === "owner"));
});

companyAiRoutes.put("/:id/ai", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const secret = requireSecret(c.env);
  const { provider, model, key } = await readChoice(await readJson(c), async () => {
    const row = await readCompanyRow(c.env, id);
    return row ? { provider: row.provider, key: await openKey(secret, id, row.key_cipher) } : null;
  });

  await checkAiKey(c.env, provider, model, key);

  const sealed = await sealKey(secret, id, key);
  try {
    await c.env.DB.prepare(
      `INSERT INTO company_ai (company_id, provider, model, key_cipher, key_hint, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, key_cipher = excluded.key_cipher,
         key_hint = excluded.key_hint, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(id, provider, model, sealed, keyHintOf(key), user.id, nowIso())
      .run();
  } catch (e) {
    if (noTable(e)) throw new HttpError(503, "The company AI table is missing. Run the database migrations, then try again.");
    throw e;
  }
  return c.json(await companySettings(c.env, id, true));
});

/** Removes the company's AI setting and its key. The company goes back to the deploy default. */
companyAiRoutes.delete("/:id/ai", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  try {
    await c.env.DB.prepare("DELETE FROM company_ai WHERE company_id = ?").bind(id).run();
  } catch (e) {
    if (!noTable(e)) throw e;
  }
  return c.json(await companySettings(c.env, id, true));
});

/** Turns personal AI keys on or off for the members of a company. Body: { allow: boolean }. */
companyAiRoutes.put("/:id/ai/member-keys", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const body = await readJson(c);
  if (typeof body.allow !== "boolean") throw new HttpError(400, "Say if members can use their own AI key: true or false.");
  try {
    await c.env.DB.prepare("UPDATE companies SET ai_member_keys = ?, updated_at = ? WHERE id = ?").bind(body.allow ? 1 : 0, nowIso(), id).run();
  } catch (e) {
    if (noTable(e)) throw new HttpError(503, "The setting for personal AI keys is missing. Run the database migrations, then try again.");
    throw e;
  }
  return c.json(await companySettings(c.env, id, true));
});

/* Personal AI */

async function userSettings(env: Env, userId: string): Promise<UserAiSettings> {
  let blockedIn: string[] = [];
  try {
    const rows = await env.DB.prepare(
      "SELECT c.name FROM companies c JOIN company_members m ON m.company_id = c.id WHERE m.user_id = ? AND c.ai_member_keys = 0 ORDER BY c.name"
    )
      .bind(userId)
      .all<{ name: string }>();
    blockedIn = rows.results.map((r) => r.name);
  } catch (e) {
    if (!noTable(e)) throw e;
  }
  const row = await readUserRow(env, userId);
  if (!row || !isCompanyAiProvider(row.provider)) return { provider: "default", model: null, keyHint: null, keyBroken: false, blockedIn };
  const broken = !(await openUserKey(env, userId, row));
  return { provider: row.provider, model: row.model, keyHint: row.key_hint, keyBroken: broken, blockedIn };
}

export const userAiRoutes = new Hono<AppEnv>();

userAiRoutes.get("/ai", async (c) => {
  const user = requireUser(c);
  return c.json(await userSettings(c.env, user.id));
});

userAiRoutes.put("/ai", async (c) => {
  const user = requireUser(c);
  const secret = requireSecret(c.env);
  const { provider, model, key } = await readChoice(await readJson(c), async () => {
    const row = await readUserRow(c.env, user.id);
    return row ? { provider: row.provider, key: await openKey(secret, user.id, row.key_cipher, USER_PURPOSE) } : null;
  });

  await checkAiKey(c.env, provider, model, key);

  const sealed = await sealKey(secret, user.id, key, USER_PURPOSE);
  try {
    await c.env.DB.prepare(
      `INSERT INTO user_ai (user_id, provider, model, key_cipher, key_hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, key_cipher = excluded.key_cipher,
         key_hint = excluded.key_hint, updated_at = excluded.updated_at`
    )
      .bind(user.id, provider, model, sealed, keyHintOf(key), nowIso())
      .run();
  } catch (e) {
    if (noTable(e)) throw new HttpError(503, "The personal AI table is missing. Ask the person who runs this deploy to run the database migrations.");
    throw e;
  }
  return c.json(await userSettings(c.env, user.id));
});

/** Removes the person's own AI and its key. The company AI or the deploy default runs again. */
userAiRoutes.delete("/ai", async (c) => {
  const user = requireUser(c);
  try {
    await c.env.DB.prepare("DELETE FROM user_ai WHERE user_id = ?").bind(user.id).run();
  } catch (e) {
    if (!noTable(e)) throw e;
  }
  return c.json(await userSettings(c.env, user.id));
});
