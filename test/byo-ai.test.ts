import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { aiOverride, companyAiChoice, companyAiRoutes, userAiRoutes } from "../packages/core/src/server/company-ai.ts";
import { HttpError } from "../packages/core/src/server/util.ts";
import { sealKey } from "../packages/core/src/server/secret-box.ts";
import {
  GEMINI_SKIP_SIGNATURE,
  parseGemini,
  parseOpenAiResponses,
  toGemini,
  toOpenAiResponses,
  type AgentMsg
} from "../apps/projects/src/server/agent/messages.ts";

/*
 * Bring your own AI: the order of keys (person, company, deploy), the company switch for personal keys,
 * the /api/me/ai routes, and the OpenAI Responses and Gemini converters.
 * Runs on SQLite with every migration and a small D1 stand-in. Provider requests are faked.
 */

const ROOT = join(import.meta.dirname, "..");
const SECRET = "a-test-secret-that-is-long-enough";
const T = "2026-01-01T00:00:00.000Z";

function migrations(): string[] {
  return ["packages/core/migrations", "apps/projects/migrations"].flatMap((d) =>
    readdirSync(join(ROOT, d))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(ROOT, d, f), "utf8"))
  );
}

function d1(db: DatabaseSync) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => ({ meta: db.prepare(sql).run(...(args as never[])) })
  });
  return { prepare: (sql: string) => stmt(sql) };
}

const USER_PURPOSE = { salt: "openact/user-ai", info: "api-key v1" };

async function setup() {
  const raw = new DatabaseSync(":memory:");
  for (const sql of migrations()) raw.exec(sql);
  const ins = (sql: string, ...a: unknown[]) => raw.prepare(sql).run(...(a as never[]));
  ins("INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'a@x.com', 'Ana', ?)", T);
  ins("INSERT INTO users (id, email, name, created_at) VALUES ('u2', 'b@x.com', 'Ben', ?)", T);
  ins("INSERT INTO companies (id, name, created_at, updated_at) VALUES ('c1', 'Acme', ?, ?)", T, T);
  ins("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES ('c1', 'u1', 'owner', ?)", T);
  ins("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES ('c1', 'u2', 'member', ?)", T);
  const env = { DB: d1(raw), AUTH_SECRET: SECRET, CF_ACCOUNT_ID: "acct", AI_GATEWAY_ID: "gw" } as any;
  const companyKey = async (key: string) =>
    ins("INSERT INTO company_ai (company_id, provider, model, key_cipher, key_hint, updated_at) VALUES ('c1', 'anthropic', 'claude-sonnet-5-5', ?, ?, ?)", await sealKey(SECRET, "c1", key), key.slice(-4), T);
  const userKey = async (userId: string, provider: string, model: string, key: string) =>
    ins("INSERT INTO user_ai (user_id, provider, model, key_cipher, key_hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)", userId, provider, model, await sealKey(SECRET, userId, key, USER_PURPOSE), key.slice(-4), T);
  return { raw, env, companyKey, userKey };
}

test("the person's key wins, then the company key, then the deploy default", async () => {
  const { env, companyKey, userKey } = await setup();
  assert.equal(await aiOverride(env, "c1", "u2"), null);
  assert.equal((await companyAiChoice(env, "c1", "u2")).source, "deploy");

  await companyKey("sk-ant-company-key-1111");
  const company = await aiOverride(env, "c1", "u2");
  assert.equal(company?.source, "company");
  assert.equal(company?.apiKey, "sk-ant-company-key-1111");

  await userKey("u2", "openai", "gpt-6.2-sol", "sk-proj-ben-2222");
  const own = await aiOverride(env, "c1", "u2");
  assert.equal(own?.source, "user");
  assert.equal(own?.provider, "openai");
  assert.equal(own?.model, "gpt-6.2-sol");
  assert.equal(own?.scopeModel, "gpt-6-luna");
  assert.equal(own?.apiKey, "sk-proj-ben-2222");
  assert.deepEqual(await companyAiChoice(env, "c1", "u2"), { provider: "openai", model: "gpt-6.2-sol", source: "user" });

  // Another person in the same company still gets the company key.
  assert.equal((await aiOverride(env, "c1", "u1"))?.source, "company");
});

test("a company can turn off personal keys", async () => {
  const { raw, env, companyKey, userKey } = await setup();
  await companyKey("sk-ant-company-key-1111");
  await userKey("u2", "google", "gemini-3.8-flash", "AIza-ben-3333");
  raw.prepare("UPDATE companies SET ai_member_keys = 0 WHERE id = 'c1'").run();
  assert.equal((await aiOverride(env, "c1", "u2"))?.source, "company");
  assert.equal((await companyAiChoice(env, "c1", "u2")).source, "company");
  // Outside a company, the person's own key still runs.
  assert.equal((await aiOverride(env, null, "u2"))?.source, "user");
});

test("a personal key is bound to its person", async () => {
  const { raw, env, userKey } = await setup();
  await userKey("u2", "openai", "gpt-6.2-sol", "sk-proj-ben-2222");
  // Copy Ben's sealed key to Ana's row. It must not open for Ana.
  const row = raw.prepare("SELECT key_cipher FROM user_ai WHERE user_id = 'u2'").get() as { key_cipher: string };
  raw.prepare("INSERT INTO user_ai (user_id, provider, model, key_cipher, key_hint, updated_at) VALUES ('u1', 'openai', 'gpt-6.2-sol', ?, '2222', ?)").run(row.key_cipher, T);
  assert.equal(await aiOverride(env, "c1", "u1"), null);
});

function app(env: any, userId: string) {
  const a = new Hono<any>();
  a.onError((e, c) => c.json({ error: e.message }, (e instanceof HttpError ? e.status : 500) as never));
  a.use("*", async (c, next) => {
    c.set("user", { id: userId, email: `${userId}@x.com`, name: userId });
    await next();
  });
  a.route("/api/me", userAiRoutes);
  a.route("/api/companies", companyAiRoutes);
  return (path: string, init?: RequestInit) => a.request(path, init, env);
}

/** Fakes the provider for the key test. Returns the URLs that were called. */
function fakeProvider(status = 200, body = "{}") {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const json = (body: unknown, method = "PUT"): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a person saves, keeps and deletes their own key", async () => {
  const { env } = await setup();
  const call = app(env, "u2");
  const fake = fakeProvider();
  try {
    let res = await call("/api/me/ai", json({ provider: "google", model: "gemini-3.8-flash", apiKey: "AIza-test-key-9876" }));
    assert.equal(res.status, 200);
    let s = (await res.json()) as any;
    assert.equal(s.provider, "google");
    assert.equal(s.keyHint, "9876");
    assert.equal(JSON.stringify(s).includes("AIza-test-key-9876"), false);
    assert.match(fake.calls[0].url, /\/acct\/gw\/google-ai-studio\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
    assert.equal((fake.calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "AIza-test-key-9876");

    // An empty key keeps the saved key for the same provider.
    res = await call("/api/me/ai", json({ provider: "google", model: "gemini-4-argon", apiKey: "" }));
    s = (await res.json()) as any;
    assert.equal(s.model, "gemini-4-argon");
    assert.equal(s.keyHint, "9876");

    // An empty key for another provider is refused.
    res = await call("/api/me/ai", json({ provider: "openai", model: "gpt-6.2-sol" }));
    assert.equal(res.status, 400);

    // Models that are not on the tested list are refused.
    res = await call("/api/me/ai", json({ provider: "openai", model: "gpt-4o", apiKey: "sk-proj-x" }));
    assert.equal(res.status, 400);

    res = await call("/api/me/ai", { method: "DELETE" });
    s = (await res.json()) as any;
    assert.equal(s.provider, "default");
    assert.equal(await aiOverride(env, "c1", "u2"), null);
  } finally {
    fake.restore();
  }
});

test("a rejected key is not saved", async () => {
  const { env } = await setup();
  const fake = fakeProvider(401, '{"error":{"message":"Incorrect API key"}}');
  try {
    const res = await app(env, "u2")("/api/me/ai", json({ provider: "openai", model: "gpt-6.2-sol", apiKey: "sk-proj-wrong" }));
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as any).error, /did not accept this API key/);
    assert.match(fake.calls[0].url, /\/openai\/responses$/);
    assert.equal(JSON.parse(String(fake.calls[0].init.body)).store, false);
    assert.equal(await aiOverride(env, "c1", "u2"), null);
  } finally {
    fake.restore();
  }
});

test("only an owner can turn personal keys off, and members see which companies did", async () => {
  const { env } = await setup();
  let res = await app(env, "u2")("/api/companies/c1/ai/member-keys", json({ allow: false }));
  assert.equal(res.status, 403);
  res = await app(env, "u1")("/api/companies/c1/ai/member-keys", json({ allow: false }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).memberKeys, false);
  const mine = (await (await app(env, "u2")("/api/me/ai")).json()) as any;
  assert.deepEqual(mine.blockedIn, ["Acme"]);
  res = await app(env, "u1")("/api/companies/c1/ai/member-keys", json({ allow: "no" }));
  assert.equal(res.status, 400);
});

/* Converters */

const history: AgentMsg[] = [
  { role: "system", content: "You help with one project." },
  { role: "user", content: "Add a task." },
  { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "create_task", args: { title: "Test" } }] },
  { role: "tool", toolCallId: "call_1", content: "Created." }
];
const tools = [{ name: "create_task", description: "Make a task.", parameters: { type: "object", properties: { title: { type: "string" } } } }];

test("OpenAI Responses: requests carry instructions, calls and results", () => {
  const body = toOpenAiResponses(history, tools);
  assert.equal(body.instructions, "You help with one project.");
  assert.deepEqual(body.input, [
    { role: "user", content: "Add a task." },
    { type: "function_call", call_id: "call_1", name: "create_task", arguments: '{"title":"Test"}' },
    { type: "function_call_output", call_id: "call_1", output: "Created." }
  ]);
  assert.deepEqual(body.tools[0], { type: "function", name: "create_task", description: "Make a task.", parameters: tools[0].parameters, strict: false });
});

test("OpenAI Responses: reasoning goes back unchanged in the next step", () => {
  const out = parseOpenAiResponses({
    output: [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC" },
      { type: "function_call", id: "fc_1", call_id: "call_9", name: "create_task", arguments: '{"title":"A"}' }
    ]
  });
  assert.deepEqual(out.toolCalls, [{ id: "call_9", name: "create_task", args: { title: "A" } }]);
  const next = toOpenAiResponses([{ role: "user", content: "Go" }, { role: "assistant", content: out.text, toolCalls: out.toolCalls, replay: out.replay }, { role: "tool", toolCallId: "call_9", content: "Done." }], tools);
  assert.deepEqual(next.input, [
    { role: "user", content: "Go" },
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC" },
    { type: "function_call", id: "fc_1", call_id: "call_9", name: "create_task", arguments: '{"title":"A"}' },
    { type: "function_call_output", call_id: "call_9", output: "Done." }
  ]);
  const final = parseOpenAiResponses({ output: [{ type: "message", content: [{ type: "output_text", text: "All set." }] }] });
  assert.equal(final.text, "All set.");
  assert.equal(final.replay, undefined);
});

test("Gemini: requests carry the system text, calls, results and tool schemas", () => {
  const body = toGemini(history, tools) as any;
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "You help with one project." }] });
  assert.deepEqual(body.contents, [
    { role: "user", parts: [{ text: "Add a task." }] },
    { role: "model", parts: [{ functionCall: { name: "create_task", args: { title: "Test" } }, thoughtSignature: GEMINI_SKIP_SIGNATURE }] },
    { role: "user", parts: [{ functionResponse: { name: "create_task", response: { result: "Created." } } }] }
  ]);
  assert.deepEqual(body.tools, [{ functionDeclarations: [{ name: "create_task", description: "Make a task.", parametersJsonSchema: tools[0].parameters }] }]);
  assert.equal(toGemini([{ role: "user", content: "Hi" }], []).hasOwnProperty("tools"), false);
});

test("Gemini: the real thought signature goes back in the next step", () => {
  const out = parseGemini({
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "thinking", thought: true },
            { functionCall: { id: "x1", name: "create_task", args: { title: "A" } }, thoughtSignature: "SIG" },
            { functionCall: { name: "create_task", args: { title: "B" } } }
          ]
        }
      }
    ]
  });
  assert.equal(out.text, "");
  assert.deepEqual(
    out.toolCalls.map((c) => c.args.title),
    ["A", "B"]
  );
  const body = toGemini([{ role: "user", content: "Go" }, { role: "assistant", content: "", toolCalls: out.toolCalls, replay: out.replay }], tools) as any;
  assert.deepEqual(body.contents[1].parts, [
    { functionCall: { name: "create_task", args: { title: "A" } }, thoughtSignature: "SIG" },
    { functionCall: { name: "create_task", args: { title: "B" } } }
  ]);
  // A call with no signature from Gemini gets the placeholder, so the next step is not refused.
  const bare = parseGemini({ candidates: [{ content: { parts: [{ functionCall: { name: "create_task", args: {} } }] } }] });
  assert.equal((bare.replay!.items[0] as any).thoughtSignature, GEMINI_SKIP_SIGNATURE);
});
