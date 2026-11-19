import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizationServerMetadata,
  bearerChallenge,
  grantedScope,
  isPkceChallenge,
  parseScope,
  pkceChallenge,
  pkceMatches,
  protectedResourceMetadata,
  redirectMatches,
  redirectUriProblem,
  resourceOk,
  scopeString
} from "../packages/core/src/server/oauth-rules.ts";
import { ToolNotFound, argsProblem, handleMcpMessage, negotiateVersion, type McpHandlers } from "../packages/core/src/server/mcp-rpc.ts";

/* OAuth rules */

test("scopes: known ones are kept once, unknown ones are listed apart", () => {
  assert.deepEqual(parseScope("mcp:read mcp:read  mcp:write admin"), { scopes: ["mcp:read", "mcp:write"], unknown: ["admin"] });
  assert.deepEqual(parseScope(undefined), { scopes: [], unknown: [] });
  assert.deepEqual(grantedScope(false), ["mcp:read"]);
  assert.equal(scopeString(grantedScope(true)), "mcp:read mcp:write");
});

test("redirect URIs: https, loopback http and native app schemes are allowed", () => {
  assert.equal(redirectUriProblem("https://claude.ai/api/mcp/auth_callback"), null);
  assert.equal(redirectUriProblem("http://localhost:6274/oauth/callback"), null);
  assert.equal(redirectUriProblem("http://127.0.0.1/callback"), null);
  assert.equal(redirectUriProblem("cursor://anysphere.cursor-retrieval/oauth/callback"), null);
  assert.equal(redirectUriProblem("com.example.app:/callback"), null);
});

test("redirect URIs: plain http, fragments, credentials and script schemes are refused", () => {
  assert.match(redirectUriProblem("http://example.com/cb")!, /https/);
  assert.match(redirectUriProblem("https://example.com/cb#x")!, /fragment/);
  assert.match(redirectUriProblem("https://user:pw@example.com/cb")!, /user name/);
  assert.match(redirectUriProblem("javascript:alert(1)")!, /cannot use/);
  assert.match(redirectUriProblem("data:text/html,hi")!, /cannot use/);
  assert.match(redirectUriProblem("/relative")!, /absolute/);
  assert.ok(redirectUriProblem(42));
});

test("redirect match: exact, except that a loopback URI may change its port", () => {
  const registered = ["https://app.example.com/cb", "http://127.0.0.1/callback"];
  assert.ok(redirectMatches(registered, "https://app.example.com/cb"));
  assert.ok(!redirectMatches(registered, "https://app.example.com/cb2"));
  assert.ok(!redirectMatches(registered, "https://app.example.com/cb?x=1"));
  assert.ok(redirectMatches(registered, "http://127.0.0.1:53111/callback"));
  assert.ok(!redirectMatches(registered, "http://127.0.0.1:53111/other"));
  assert.ok(!redirectMatches(registered, "http://localhost:53111/callback"), "the loopback host must match too");
  assert.ok(!redirectMatches(["https://app.example.com:443/cb"], "https://app.example.com:8443/cb"), "only loopback may change the port");
});

test("PKCE S256: the RFC 7636 example verifier matches its challenge", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(await pkceChallenge(verifier), challenge);
  assert.ok(await pkceMatches(verifier, challenge));
  assert.ok(!(await pkceMatches(verifier.slice(0, -1) + "Y", challenge)));
  assert.ok(!(await pkceMatches("short", challenge)), "a verifier needs 43 to 128 characters");
  assert.ok(isPkceChallenge(challenge));
  assert.ok(!isPkceChallenge("plain-challenge"));
});

test("resource indicator: only this site's MCP endpoint, or none", () => {
  const issuer = "https://app.example.com";
  assert.ok(resourceOk(undefined, issuer));
  assert.ok(resourceOk("https://app.example.com/mcp", issuer));
  assert.ok(resourceOk("https://app.example.com/mcp/", issuer));
  assert.ok(resourceOk("https://app.example.com", issuer));
  assert.ok(!resourceOk("https://other.example.com/mcp", issuer));
  assert.ok(!resourceOk(["https://app.example.com/mcp"], issuer));
});

test("metadata: the protected resource points to the authorization server, which requires PKCE", () => {
  const issuer = "https://app.example.com";
  const as = authorizationServerMetadata(issuer);
  assert.equal(as.issuer, issuer);
  assert.equal(as.token_endpoint, `${issuer}/oauth/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  const pr = protectedResourceMetadata(issuer, "A/GEO Answers");
  assert.equal(pr.resource, `${issuer}/mcp`);
  assert.deepEqual(pr.authorization_servers, [issuer]);
  assert.deepEqual(pr.bearer_methods_supported, ["header"]);
  assert.equal(
    bearerChallenge(issuer, "invalid_token", 'Bad "token"'),
    `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Bad token"`
  );
});

/* MCP */

const schema = {
  type: "object" as const,
  properties: {
    url: { type: "string" as const, maxLength: 20 },
    count: { type: "integer" as const, minimum: 1, maximum: 5 },
    mode: { type: "string" as const, enum: ["fast", "full"] },
    tags: { type: "array" as const, items: { type: "string" as const }, maxItems: 2 }
  },
  required: ["url"],
  additionalProperties: false
};

test("tool arguments: required, types, limits and unknown keys", () => {
  assert.equal(argsProblem(schema, { url: "example.com" }), null);
  assert.match(argsProblem(schema, {})!, /"url" is required/);
  assert.match(argsProblem(schema, { url: 5 })!, /must be a string/);
  assert.match(argsProblem(schema, { url: "x".repeat(21) })!, /too long/);
  assert.match(argsProblem(schema, { url: "a", count: 1.5 })!, /whole number/);
  assert.match(argsProblem(schema, { url: "a", count: 9 })!, /5 or less/);
  assert.match(argsProblem(schema, { url: "a", mode: "slow" })!, /one of: fast, full/);
  assert.match(argsProblem(schema, { url: "a", tags: ["a", "b", "c"] })!, /2 items or fewer/);
  assert.match(argsProblem(schema, { url: "a", tags: ["a", 3] })!, /tags\[1\]/);
  assert.match(argsProblem(schema, { url: "a", extra: 1 })!, /not an argument/);
  assert.match(argsProblem(schema, [])!, /JSON object/);
});

const handlers = (calls: string[] = []): McpHandlers => ({
  serverInfo: { name: "Test", version: "0.2.0" },
  instructions: "Hi",
  listTools: async () => [{ name: "demo_echo", description: "Echo", inputSchema: { type: "object" } }],
  callTool: async (name, args) => {
    calls.push(name);
    if (name !== "demo_echo") throw new ToolNotFound();
    if (args.fail) throw new Error("boom");
    return { content: [{ type: "text", text: String(args.text ?? "") }] };
  }
});

test("MCP initialize: negotiates the version and offers tools", async () => {
  const r = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, handlers());
  const result = r!.result as Record<string, unknown>;
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(result.serverInfo, { name: "Test", version: "0.2.0" });
  assert.equal(negotiateVersion("1999-01-01"), negotiateVersion(undefined));
});

test("MCP: notifications get no reply, ping and tools/list work", async () => {
  assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, handlers()), null);
  assert.deepEqual((await handleMcpMessage({ jsonrpc: "2.0", id: "a", method: "ping" }, handlers()))!.result, {});
  const list = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, handlers());
  assert.equal((list!.result as { tools: unknown[] }).tools.length, 1);
});

test("MCP tools/call: runs the tool, and an unknown tool is an invalid-params error", async () => {
  const ok = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo_echo", arguments: { text: "hi" } } }, handlers());
  assert.deepEqual(ok!.result, { content: [{ type: "text", text: "hi" }] });
  const missing = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }, handlers());
  assert.equal(missing!.error!.code, -32602);
  const bad = await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "demo_echo", arguments: [1] } }, handlers());
  assert.equal(bad!.error!.code, -32602);
});

test("MCP: a thrown error is an internal error without details, and bad messages are refused", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const r = await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "demo_echo", arguments: { fail: true } } }, handlers());
    assert.equal(r!.error!.code, -32603);
    assert.doesNotMatch(r!.error!.message, /boom/);
  } finally {
    console.error = origError;
  }
  assert.equal((await handleMcpMessage([{ jsonrpc: "2.0", id: 1, method: "ping" }], handlers()))!.error!.code, -32600);
  assert.equal((await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "resources/list" }, handlers()))!.error!.code, -32601);
  assert.equal((await handleMcpMessage({ jsonrpc: "2.0", id: { x: 1 }, method: "ping" }, handlers()))!.error!.code, -32600);
});
