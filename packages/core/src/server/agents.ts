import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "./env";
import type { User } from "../shared/types";
import { getApps, type AgentTool, type ToolOutput } from "./apps";
import { listCompanies } from "./companies";
import { companyRole } from "./data";
import { companyAppState, requirePermission, siteAppOff } from "./permissions";
import { loadSite } from "./site";
import { HttpError, appName, appUrl, newId, randomToken, readJson, requireUser, sha256Hex } from "./util";
import {
  ACCESS_TOKEN_TTL_MS,
  CODE_TTL_MS,
  MAX_CLIENTS_PER_IP_HOUR,
  MAX_REDIRECT_URIS,
  REFRESH_TOKEN_TTL_MS,
  authorizationServerMetadata,
  bearerChallenge,
  grantedScope,
  isPkceChallenge,
  mcpResource,
  parseScope,
  pkceMatches,
  protectedResourceMetadata,
  redirectMatches,
  redirectUriProblem,
  resourceOk,
  scopeString,
  type AgentScope
} from "./oauth-rules";
import { LATEST_PROTOCOL_VERSION, ToolNotFound, argsProblem, handleMcpMessage, type McpCallResult, type McpToolInfo } from "./mcp-rpc";

/*
 * Agent access: AI agents sign in with OAuth 2.1 and call the apps' tools over MCP.
 * Off unless AGENT_ACCESS is "on". See docs/agent-access.md.
 *
 *   GET  /.well-known/oauth-authorization-server     Authorization server metadata (RFC 8414)
 *   GET  /.well-known/oauth-protected-resource[/mcp]  Protected resource metadata (RFC 9728)
 *   GET  /.well-known/mcp/server-card.json            MCP server card
 *   POST /oauth/register                              Client registration (RFC 7591), public clients only
 *   GET  /oauth/authorize                             The consent page (web app), which calls /api/oauth/authorize
 *   POST /oauth/token                                 Codes and refresh tokens for tokens (PKCE S256)
 *   POST /oauth/revoke                                Token revocation (RFC 7009)
 *   POST /mcp                                         MCP for a signed-in agent: the tools the person may use
 *   POST /mcp/public                                  MCP without sign-in: public tools only
 *
 * An agent acts for one person in one company. Every tool call checks the person's role, the app's state
 * and the plan again, so an agent never does more than the person can.
 */

const CORE_VERSION = "0.2.0";
const MAX_BODY_BYTES = 1_000_000;

export const agentAccessOn = (env: Env): boolean => (env.AGENT_ACCESS || "").trim().toLowerCase() === "on";

const issuerOf = (c: Context<AppEnv>) => appUrl(c);

function cors(c: Context<AppEnv>): void {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
  c.header("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  c.header("Access-Control-Max-Age", "86400");
}

function plain(c: Context<AppEnv>): void {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
}

/** The OAuth error body (RFC 6749, section 5.2). */
const oauthError = (c: Context<AppEnv>, status: 400 | 401 | 403 | 404 | 429, error: string, description: string) =>
  c.json({ error, error_description: description }, status);

/** True when the migration that adds the agent tables has not run yet. */
const missingTables = (e: unknown) => /no such table/i.test(String(e));

/** Reads a form or JSON body as flat strings. */
async function readParams(c: Context<AppEnv>): Promise<Record<string, string>> {
  const type = c.req.header("content-type") || "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = await readJson(c);
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  }
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  for (const [k, v] of Object.entries(form)) if (typeof v === "string") out[k] = v;
  return out;
}

/* Clients */

interface ClientRow {
  id: string;
  name: string;
  client_uri: string | null;
  redirect_uris: string;
}

async function findClient(env: Env, id: unknown): Promise<(ClientRow & { redirects: string[] }) | null> {
  if (typeof id !== "string" || id.length > 100) return null;
  const row = await env.DB.prepare("SELECT id, name, client_uri, redirect_uris FROM oauth_clients WHERE id = ?").bind(id).first<ClientRow>();
  if (!row) return null;
  let redirects: string[] = [];
  try {
    redirects = JSON.parse(row.redirect_uris);
  } catch {
    redirects = [];
  }
  return { ...row, redirects };
}

/* Tokens */

interface TokenSubject {
  grantId: string;
  user: User;
  companyId: string;
  scopes: AgentScope[];
}

async function issueTokens(env: Env, grantId: string, scope: string): Promise<Record<string, unknown>> {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO oauth_tokens (id, grant_id, kind, created_at, expires_at) VALUES (?, ?, 'access', ?, ?)").bind(
      await sha256Hex(access),
      grantId,
      now,
      now + ACCESS_TOKEN_TTL_MS
    ),
    env.DB.prepare("INSERT INTO oauth_tokens (id, grant_id, kind, created_at, expires_at) VALUES (?, ?, 'refresh', ?, ?)").bind(
      await sha256Hex(refresh),
      grantId,
      now,
      now + REFRESH_TOKEN_TTL_MS
    )
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: refresh, scope };
}

/** Reads the Bearer token of an MCP request. Returns null when there is none, or the token does not work. */
async function readBearer(c: Context<AppEnv>): Promise<TokenSubject | null> {
  const header = c.req.header("authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9\-_]{20,100})$/.exec(header.trim());
  if (!m) return null;
  const row = await c.env.DB.prepare(
    `SELECT g.id AS grant_id, g.company_id, g.scope, g.last_used_at, u.id, u.email, u.name
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
     WHERE t.id = ? AND t.kind = 'access' AND t.expires_at > ?`
  )
    .bind(await sha256Hex(m[1]), Date.now())
    .first<{ grant_id: string; company_id: string; scope: string; last_used_at: number | null; id: string; email: string; name: string }>();
  if (!row) return null;
  // A person who left the company loses the agent too.
  if (!(await companyRole(c.env, row.company_id, row.id))) {
    await c.env.DB.prepare("DELETE FROM oauth_grants WHERE id = ?").bind(row.grant_id).run();
    return null;
  }
  const now = Date.now();
  if (!row.last_used_at || now - row.last_used_at > 10 * 60000) {
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").bind(now, row.grant_id).run());
  }
  return {
    grantId: row.grant_id,
    user: { id: row.id, email: row.email, name: row.name },
    companyId: row.company_id,
    scopes: parseScope(row.scope).scopes
  };
}

/* Tools */

interface ToolEntry {
  appId: string;
  tool: AgentTool;
}

const allTools = (): ToolEntry[] => getApps().flatMap((a) => (a.tools ?? []).map((tool) => ({ appId: a.id, tool })));

/** Why a person cannot use a tool, or null when they can. */
async function toolProblem(env: Env, entry: ToolEntry, who: TokenSubject | null): Promise<string | null> {
  const { appId, tool } = entry;
  if (siteAppOff(appId)) return `The app of "${tool.name}" is off for this site.`;
  if (!who) return tool.public ? null : `"${tool.name}" needs sign-in. Connect the agent at /mcp.`;
  const needed: AgentScope = tool.readOnly ? "mcp:read" : "mcp:write";
  if (!who.scopes.includes(needed))
    return `"${tool.name}" changes data, but the person did not allow changes. Connect the agent again and allow changes.`;
  if (tool.public) return null;
  const [role, state] = await Promise.all([companyRole(env, who.companyId, who.user.id), companyAppState(env, who.companyId)]);
  if (!role) return "You are not in this company anymore.";
  if (!state.enabled(appId)) return `The app of "${tool.name}" is off for this company.`;
  if (!state.roles(tool.permission!).includes(role)) return `Your role in this company does not allow "${tool.title}".`;
  return null;
}

function toolInfo({ tool }: ToolEntry): McpToolInfo {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, readOnlyHint: !!tool.readOnly, destructiveHint: false }
  };
}

function toResult(out: ToolOutput): McpCallResult {
  if (typeof out === "string") return { content: [{ type: "text", text: out }] };
  return { content: [{ type: "text", text: out.text }], ...(out.data ? { structuredContent: out.data } : {}) };
}

const toolError = (text: string): McpCallResult => ({ content: [{ type: "text", text }], isError: true });

async function serveMcp(c: Context<AppEnv>, who: TokenSubject | null) {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "The request is too large." } }, 413);
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Send the request body as JSON." } }, 400);
  }
  await loadSite(c.env);
  const name = appName(c.env);
  const reply = await handleMcpMessage(message, {
    serverInfo: { name, title: name, version: CORE_VERSION },
    instructions: who
      ? `Tools of ${name}. Each tool acts as the person who connected you, in one company, and can do only what their role allows.`
      : `Public tools of ${name}. Sign in at ${issuerOf(c)}/mcp for the tools of a company.`,
    listTools: async () => {
      const out: McpToolInfo[] = [];
      for (const entry of allTools()) if (!(await toolProblem(c.env, entry, who))) out.push(toolInfo(entry));
      return out;
    },
    callTool: async (toolName, args) => {
      const entry = allTools().find((e) => e.tool.name === toolName);
      if (!entry || (!who && !entry.tool.public)) throw new ToolNotFound();
      const problem = await toolProblem(c.env, entry, who);
      if (problem) return toolError(problem);
      const bad = argsProblem(entry.tool.inputSchema, args);
      if (bad) return toolError(bad);
      try {
        // The canonical check, again, right before the tool runs.
        if (who && !entry.tool.public) await requirePermission(c.env, who.companyId, who.user.id, entry.tool.permission!);
        const out = await entry.tool.run(
          { env: c.env, user: who?.user ?? null, companyId: who?.companyId ?? null, origin: issuerOf(c), waitUntil: (p) => c.executionCtx.waitUntil(p) },
          args
        );
        return toResult(out);
      } catch (e) {
        if (e instanceof HttpError) return toolError(e.message);
        console.error(`[openact] tool ${toolName} failed`, e);
        return toolError("The tool failed on the server. Try again.");
      }
    }
  });
  if (!reply) return c.body(null, 202);
  return c.json(reply);
}

/* Routes outside /api */

export const agentRoutes = new Hono<AppEnv>();

/** The paths of the agent routes outside /api. The host's wrangler.jsonc must send them to the Worker first (run_worker_first). */
export const AGENT_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/*",
  "/.well-known/mcp/*",
  "/oauth/register",
  "/oauth/token",
  "/oauth/revoke",
  "/mcp",
  "/mcp/*"
] as const;

// Every agent route answers 404 when agent access is off, and allows cross-origin calls (agents use tokens, not cookies).
for (const path of AGENT_PATHS)
  agentRoutes.use(path, async (c, next) => {
    cors(c);
    plain(c);
    if (!agentAccessOn(c.env)) return c.json({ error: "Agent access is off on this site." }, 404);
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

agentRoutes.get("/.well-known/oauth-authorization-server", (c) => {
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(authorizationServerMetadata(issuerOf(c)));
});

const resourceMetadata = (c: Context<AppEnv>) => {
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(protectedResourceMetadata(issuerOf(c), appName(c.env)));
};
agentRoutes.get("/.well-known/oauth-protected-resource", resourceMetadata);
agentRoutes.get("/.well-known/oauth-protected-resource/mcp", resourceMetadata);

agentRoutes.get("/.well-known/mcp/server-card.json", async (c) => {
  await loadSite(c.env);
  const issuer = issuerOf(c);
  const name = appName(c.env);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({
    protocolVersion: LATEST_PROTOCOL_VERSION,
    serverInfo: { name, title: name, version: CORE_VERSION },
    description: `The tools of the apps on ${name}. An agent acts for one person in one company.`,
    transport: { type: "streamable-http", endpoint: `${issuer}/mcp` },
    remotes: [
      { type: "streamable-http", url: `${issuer}/mcp`, authentication: { required: true, schemes: ["oauth2"], resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp` } },
      { type: "streamable-http", url: `${issuer}/mcp/public`, authentication: { required: false } }
    ],
    capabilities: { tools: { listChanged: false } },
    authentication: { required: true, schemes: ["oauth2"], authorizationServer: issuer },
    documentation: "https://docs.openact.app/agent-access"
  });
});

agentRoutes.post("/oauth/register", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await readJson(c);
  } catch {
    return oauthError(c, 400, "invalid_client_metadata", "Send the client metadata as a JSON object.");
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS)
    return oauthError(c, 400, "invalid_redirect_uri", `Send 1 to ${MAX_REDIRECT_URIS} redirect URIs.`);
  for (const u of uris) {
    const problem = redirectUriProblem(u);
    if (problem) return oauthError(c, 400, "invalid_redirect_uri", problem);
  }
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") return oauthError(c, 400, "invalid_client_metadata", 'Only public clients can register here. Use token_endpoint_auth_method "none" and PKCE.');
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"];
  if (!grants.every((g) => g === "authorization_code" || g === "refresh_token"))
    return oauthError(c, 400, "invalid_client_metadata", "Only the authorization_code and refresh_token grant types are supported.");
  const responses = Array.isArray(body.response_types) ? body.response_types : ["code"];
  if (!responses.every((r) => r === "code")) return oauthError(c, 400, "invalid_client_metadata", 'Only the response type "code" is supported.');
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "An AI agent";
  let clientUri: string | null = null;
  if (typeof body.client_uri === "string" && body.client_uri) {
    try {
      const u = new URL(body.client_uri);
      if (u.protocol === "https:") clientUri = u.toString().slice(0, 500);
    } catch {
      clientUri = null;
    }
  }

  const ip = c.req.header("cf-connecting-ip") || "local";
  const now = Date.now();
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_clients WHERE created_ip = ? AND created_at > ?")
    .bind(ip, now - 3600000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_CLIENTS_PER_IP_HOUR) return oauthError(c, 429, "invalid_client_metadata", "Too many agents registered from this network. Wait an hour.");

  const id = newId();
  const redirects = (uris as string[]).map(String);
  await c.env.DB.prepare("INSERT INTO oauth_clients (id, name, client_uri, redirect_uris, created_ip, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name, clientUri, JSON.stringify(redirects), ip, now)
    .run();
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      ...(clientUri ? { client_uri: clientUri } : {}),
      redirect_uris: redirects,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    },
    201
  );
});

agentRoutes.post("/oauth/token", async (c) => {
  c.header("Pragma", "no-cache");
  const p = await readParams(c);
  const client = await findClient(c.env, p.client_id);
  if (!client) return oauthError(c, 401, "invalid_client", "This client is not registered. Register it at /oauth/register.");
  if (!resourceOk(p.resource, issuerOf(c))) return oauthError(c, 400, "invalid_target", `Tokens here are for ${mcpResource(issuerOf(c))}.`);
  const now = Date.now();

  if (p.grant_type === "authorization_code") {
    if (!p.code || p.code.length > 100) return oauthError(c, 400, "invalid_request", "Send the code.");
    const codeId = await sha256Hex(p.code);
    const row = await c.env.DB.prepare(
      `SELECT k.grant_id, k.redirect_uri, k.code_challenge, k.expires_at, k.used_at, g.client_id, g.scope
       FROM oauth_codes k JOIN oauth_grants g ON g.id = k.grant_id WHERE k.id = ?`
    )
      .bind(codeId)
      .first<{ grant_id: string; redirect_uri: string; code_challenge: string; expires_at: number; used_at: number | null; client_id: string; scope: string }>();
    if (!row || row.client_id !== client.id) return oauthError(c, 400, "invalid_grant", "The code is not valid. Start the sign-in again.");
    if (row.used_at) {
      // A code used twice: someone may have copied it. Disconnect the agent (RFC 6749, section 4.1.2).
      await c.env.DB.prepare("DELETE FROM oauth_grants WHERE id = ?").bind(row.grant_id).run();
      return oauthError(c, 400, "invalid_grant", "The code was already used. Start the sign-in again.");
    }
    if (row.expires_at < now) return oauthError(c, 400, "invalid_grant", "The code is expired. Start the sign-in again.");
    if (p.redirect_uri !== row.redirect_uri) return oauthError(c, 400, "invalid_grant", "The redirect URI does not match the one in the sign-in request.");
    if (!(await pkceMatches(p.code_verifier, row.code_challenge))) return oauthError(c, 400, "invalid_grant", "The code verifier does not match the code challenge.");
    const used = await c.env.DB.prepare("UPDATE oauth_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now, codeId).run();
    if (!used.meta.changes) return oauthError(c, 400, "invalid_grant", "The code was already used. Start the sign-in again.");
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?").bind(now, client.id).run());
    return c.json(await issueTokens(c.env, row.grant_id, row.scope));
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token || p.refresh_token.length > 100) return oauthError(c, 400, "invalid_request", "Send the refresh token.");
    const tokenId = await sha256Hex(p.refresh_token);
    const row = await c.env.DB.prepare(
      `SELECT t.grant_id, g.client_id, g.user_id, g.company_id, g.scope FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
       WHERE t.id = ? AND t.kind = 'refresh' AND t.expires_at > ?`
    )
      .bind(tokenId, now)
      .first<{ grant_id: string; client_id: string; user_id: string; company_id: string; scope: string }>();
    if (!row || row.client_id !== client.id) return oauthError(c, 400, "invalid_grant", "The refresh token is not valid. Sign in again.");
    if (!(await companyRole(c.env, row.company_id, row.user_id))) {
      await c.env.DB.prepare("DELETE FROM oauth_grants WHERE id = ?").bind(row.grant_id).run();
      return oauthError(c, 400, "invalid_grant", "The person is not in this company anymore.");
    }
    // A narrower scope is fine. A wider one is not.
    let scope = row.scope;
    if (p.scope) {
      const asked = parseScope(p.scope);
      const have = parseScope(row.scope).scopes;
      if (asked.unknown.length || !asked.scopes.every((s) => have.includes(s))) return oauthError(c, 400, "invalid_scope", "A refresh cannot add scopes. Sign in again.");
      scope = scopeString(asked.scopes);
    }
    // Rotation: the old refresh token stops working.
    await c.env.DB.prepare("DELETE FROM oauth_tokens WHERE id = ?").bind(tokenId).run();
    return c.json(await issueTokens(c.env, row.grant_id, scope));
  }

  return oauthError(c, 400, "unsupported_grant_type", "Use grant_type authorization_code or refresh_token.");
});

agentRoutes.post("/oauth/revoke", async (c) => {
  const p = await readParams(c);
  if (p.token && p.token.length <= 100) {
    const row = await c.env.DB.prepare("SELECT grant_id, kind FROM oauth_tokens WHERE id = ?").bind(await sha256Hex(p.token)).first<{ grant_id: string; kind: string }>();
    if (row?.kind === "refresh") await c.env.DB.prepare("DELETE FROM oauth_grants WHERE id = ?").bind(row.grant_id).run();
    else if (row) await c.env.DB.prepare("DELETE FROM oauth_tokens WHERE id = ?").bind(await sha256Hex(p.token)).run();
  }
  return c.body(null, 200); // Always 200, so the answer says nothing about the token (RFC 7009).
});

agentRoutes.post("/mcp", async (c) => {
  const who = await readBearer(c);
  if (!who) {
    const sent = !!c.req.header("authorization");
    c.header("WWW-Authenticate", bearerChallenge(issuerOf(c), sent ? "invalid_token" : undefined, sent ? "The token is not valid or is expired." : undefined));
    return c.json({ error: "Sign in to use the tools. Connect this agent with OAuth." }, 401);
  }
  return serveMcp(c, who);
});

agentRoutes.post("/mcp/public", (c) => serveMcp(c, null));

const noStream = (c: Context<AppEnv>) => {
  c.header("Allow", "POST, OPTIONS");
  return c.json({ error: "This MCP server does not keep sessions or streams. Send each JSON-RPC message with POST." }, 405);
};
agentRoutes.get("/mcp", noStream);
agentRoutes.delete("/mcp", noStream);
agentRoutes.get("/mcp/public", noStream);

/* Routes inside /api: the consent page and the person's connected agents */

interface AuthorizeParams {
  client: ClientRow & { redirects: string[] };
  redirectUri: string;
  state: string;
  challenge: string;
  wantsWrite: boolean;
}

/** Builds the redirect back to the agent, with an error or a code (RFC 6749, section 4.1.2; RFC 9207 for iss). */
function backTo(redirectUri: string, issuer: string, fields: Record<string, string>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(fields)) if (v) u.searchParams.set(k, v);
  u.searchParams.set("iss", issuer);
  return u.toString();
}

/**
 * Checks an authorization request. Throws HttpError when the client or the redirect URI is wrong: then the page
 * shows the error and never redirects. Returns { redirect } for other errors, which go back to the agent.
 */
async function checkAuthorize(env: Env, issuer: string, q: Record<string, unknown>): Promise<AuthorizeParams | { redirect: string }> {
  const client = await findClient(env, q.client_id);
  if (!client) throw new HttpError(400, "This agent is not registered with this site. Start the connection again from the agent.");
  const redirectUri = typeof q.redirect_uri === "string" ? q.redirect_uri : client.redirects.length === 1 ? client.redirects[0] : "";
  if (!redirectUri || !redirectMatches(client.redirects, redirectUri))
    throw new HttpError(400, "The agent sent a return address that it did not register. Start the connection again from the agent.");
  const state = typeof q.state === "string" ? q.state.slice(0, 500) : "";
  const fail = (error: string, description: string) => ({ redirect: backTo(redirectUri, issuer, { error, error_description: description, state }) });
  if (q.response_type !== "code") return fail("unsupported_response_type", 'Use response_type "code".');
  if (q.code_challenge_method !== "S256" || !isPkceChallenge(q.code_challenge)) return fail("invalid_request", "PKCE with S256 is required.");
  const scope = parseScope(q.scope);
  if (scope.unknown.length) return fail("invalid_scope", `Unknown scope: ${scope.unknown.join(", ")}.`);
  if (!resourceOk(q.resource, issuer)) return fail("invalid_target", `Ask for ${mcpResource(issuer)}.`);
  return { client, redirectUri, state, challenge: q.code_challenge as string, wantsWrite: scope.scopes.includes("mcp:write") };
}

export const agentApiRoutes = new Hono<AppEnv>();

agentApiRoutes.use("*", async (c, next) => {
  if (!agentAccessOn(c.env)) throw new HttpError(404, "Agent access is off on this site. A site admin can turn it on with AGENT_ACCESS.");
  await next();
});

/** What the consent page shows. The query is the agent's authorization request. */
agentApiRoutes.get("/authorize", async (c) => {
  const user = requireUser(c);
  const checked = await checkAuthorize(c.env, issuerOf(c), c.req.query());
  if ("redirect" in checked) return c.json({ redirect: checked.redirect });
  const companies = (await listCompanies(c.env, user.id)).map((co) => ({ id: co.id, name: co.name, role: co.role }));
  return c.json({
    client: { name: checked.client.name, uri: checked.client.client_uri, redirectHost: new URL(checked.redirectUri).host },
    wantsWrite: checked.wantsWrite,
    companies
  });
});

/** The person's answer. Body: the authorization request fields, plus companyId, allow and allowChanges. */
agentApiRoutes.post("/authorize", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const issuer = issuerOf(c);
  const checked = await checkAuthorize(c.env, issuer, body);
  if ("redirect" in checked) return c.json({ redirect: checked.redirect });
  if (body.allow !== true) return c.json({ redirect: backTo(checked.redirectUri, issuer, { error: "access_denied", error_description: "The person said no.", state: checked.state }) });

  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  if (!companyId || !(await companyRole(c.env, companyId, user.id))) throw new HttpError(400, "Pick a company that you are in.");
  const scope = scopeString(grantedScope(body.allowChanges === true));
  const code = randomToken(32);
  const grantId = newId();
  const now = Date.now();
  await c.env.DB.batch([
    // One connection per agent, person and company: a new approval replaces the old one.
    c.env.DB.prepare("DELETE FROM oauth_grants WHERE client_id = ? AND user_id = ? AND company_id = ?").bind(checked.client.id, user.id, companyId),
    c.env.DB.prepare("INSERT INTO oauth_grants (id, client_id, user_id, company_id, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      grantId,
      checked.client.id,
      user.id,
      companyId,
      scope,
      now
    ),
    c.env.DB.prepare("INSERT INTO oauth_codes (id, grant_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?)").bind(
      await sha256Hex(code),
      grantId,
      checked.redirectUri,
      checked.challenge,
      now + CODE_TTL_MS
    )
  ]);
  return c.json({ redirect: backTo(checked.redirectUri, issuer, { code, state: checked.state }) });
});

/** The signed-in person's connected agents, for Account settings. Works when agent access is off, so people can still disconnect. */
export const agentAccountRoutes = new Hono<AppEnv>();

agentAccountRoutes.get("/agents", async (c) => {
  const user = requireUser(c);
  try {
    const rows = await c.env.DB.prepare(
      `SELECT g.id, g.scope, g.created_at, g.last_used_at, k.name AS client_name, k.client_uri, co.name AS company_name
       FROM oauth_grants g JOIN oauth_clients k ON k.id = g.client_id JOIN companies co ON co.id = g.company_id
       WHERE g.user_id = ? ORDER BY g.created_at DESC`
    )
      .bind(user.id)
      .all<{ id: string; scope: string; created_at: number; last_used_at: number | null; client_name: string; client_uri: string | null; company_name: string }>();
    return c.json({
      enabled: agentAccessOn(c.env),
      agents: rows.results.map((r) => ({
        id: r.id,
        name: r.client_name,
        uri: r.client_uri,
        company: r.company_name,
        canChange: parseScope(r.scope).scopes.includes("mcp:write"),
        connectedAt: new Date(r.created_at).toISOString(),
        lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null
      }))
    });
  } catch (e) {
    if (missingTables(e)) return c.json({ enabled: false, agents: [] });
    throw e;
  }
});

agentAccountRoutes.delete("/agents/:id", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare("DELETE FROM oauth_grants WHERE id = ? AND user_id = ?").bind(c.req.param("id"), user.id).run();
  return c.json({ ok: true });
});

/* Housekeeping */

/** The daily clean-up: expired codes and tokens, and registrations that no one connected within 30 days. */
export async function cleanupAgentAccess(env: Env): Promise<void> {
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(now - 86400000),
      env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").bind(now),
      // A connection whose tokens all expired is gone for good: the agent must sign in again.
      env.DB.prepare("DELETE FROM oauth_grants WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.grant_id = oauth_grants.id)").bind(now - 86400000),
      env.DB.prepare("DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id)").bind(
        now - 30 * 86400000
      )
    ]);
  } catch (e) {
    if (!missingTables(e)) throw e;
  }
}
