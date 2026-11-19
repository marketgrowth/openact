/*
 * Rules for agent sign-in (OAuth 2.1). Pure module: no database and no Hono, so tests can run it.
 *
 * OpenAct is its own authorization server. An AI agent (an MCP client) registers itself (RFC 7591),
 * sends the person to /oauth/authorize, and gets a code. It trades the code and its PKCE verifier
 * for tokens at /oauth/token. Clients are public: they have no secret, so PKCE with S256 is required.
 */

/** What an agent can ask for. "mcp:read" runs tools that only read. "mcp:write" also runs tools that change data. */
export const AGENT_SCOPES = ["mcp:read", "mcp:write"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const SCOPE_LABELS: Record<AgentScope, string> = {
  "mcp:read": "Read data with the tools of your apps",
  "mcp:write": "Change data with the tools of your apps"
};

export const ACCESS_TOKEN_TTL_MS = 3600000; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 86400000; // 30 days
export const CODE_TTL_MS = 10 * 60000; // 10 minutes
export const MAX_REDIRECT_URIS = 10;
export const MAX_CLIENTS_PER_IP_HOUR = 20;

/** Splits a scope string. Unknown scopes are listed apart, so the caller can refuse them. */
export function parseScope(raw: unknown): { scopes: AgentScope[]; unknown: string[] } {
  const parts = typeof raw === "string" ? raw.split(/\s+/).filter(Boolean) : [];
  const scopes: AgentScope[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    if ((AGENT_SCOPES as readonly string[]).includes(p)) {
      if (!scopes.includes(p as AgentScope)) scopes.push(p as AgentScope);
    } else unknown.push(p);
  }
  return { scopes, unknown };
}

/** The scope a person grants. Read is always in it. Write only when the person allows changes. */
export function grantedScope(allowChanges: boolean): AgentScope[] {
  return allowChanges ? ["mcp:read", "mcp:write"] : ["mcp:read"];
}

export const scopeString = (scopes: readonly string[]) => [...scopes].sort().join(" ");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "ftp:", "ws:", "wss:"]);

export const isLoopback = (u: URL) => u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);

/**
 * Checks one redirect URI from a client registration. Returns a problem message, or null when it is fine.
 * Allowed: https URLs, http URLs on the loopback address (apps on the person's computer, RFC 8252),
 * and private-use schemes of native apps, such as "cursor://" or "com.example.app:/callback".
 */
export function redirectUriProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 2000) return "Each redirect URI must be text of 2,000 characters or fewer.";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `The redirect URI "${raw.slice(0, 100)}" is not an absolute URL.`;
  }
  if (u.hash) return "A redirect URI cannot have a fragment (#).";
  if (u.username || u.password) return "A redirect URI cannot hold a user name or password.";
  if (BLOCKED_SCHEMES.has(u.protocol)) return `Redirect URIs cannot use ${u.protocol}`;
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:") return isLoopback(u) ? null : "Use https for redirect URIs. Plain http works only on localhost.";
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) ? null : "The redirect URI has a scheme that is not allowed.";
}

/**
 * True when the redirect URI of an authorization request matches a registered one.
 * The match is exact, except that a loopback URI may use any port (RFC 8252, section 7.3).
 */
export function redirectMatches(registered: readonly string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  if (!isLoopback(g)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return isLoopback(u) && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
    } catch {
      return false;
    }
  });
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The S256 code challenge of a PKCE code verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export const isPkceVerifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
export const isPkceChallenge = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9\-_]{43}$/.test(v);

export async function pkceMatches(verifier: unknown, challenge: string): Promise<boolean> {
  if (!isPkceVerifier(verifier)) return false;
  return (await pkceChallenge(verifier)) === challenge;
}

/** The MCP endpoint of a site. Tokens are for this resource only (RFC 8707). */
export const mcpResource = (issuer: string) => `${issuer}/mcp`;

/** True when an authorization or token request names this site's resource, or no resource. */
export function resourceOk(resource: unknown, issuer: string): boolean {
  if (resource === undefined || resource === null || resource === "") return true;
  if (typeof resource !== "string") return false;
  const r = resource.replace(/\/+$/, "");
  return r === issuer || r === mcpResource(issuer);
}

/** Authorization server metadata (RFC 8414). */
export function authorizationServerMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...AGENT_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: "https://docs.openact.app/agent-access"
  };
}

/** Protected resource metadata (RFC 9728) for the MCP endpoint. */
export function protectedResourceMetadata(issuer: string, name: string): Record<string, unknown> {
  return {
    resource: mcpResource(issuer),
    resource_name: name,
    authorization_servers: [issuer],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://docs.openact.app/agent-access"
  };
}

/** The WWW-Authenticate header for a request to the MCP endpoint without a working token (RFC 9728, section 5.1). */
export function bearerChallenge(issuer: string, error?: "invalid_token" | "insufficient_scope", description?: string): string {
  const parts = [`resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/["\\]/g, "")}"`);
  return `Bearer ${parts.join(", ")}`;
}
