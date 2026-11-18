# Agent access (MCP and OAuth)

AI agents, such as Claude, ChatGPT or Cursor, can use the tools of your apps over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP). An agent signs in with OAuth 2.1, as one person in one company. It can do only what that person's role allows.

Agent access is off by default. Turn it on for a deploy with one variable.

## Turn it on

1. Set `AGENT_ACCESS` to `on` in `wrangler.jsonc` (`vars`), or in the Cloudflare dashboard.
2. Set `APP_URL` to the address of the site, such as `https://app.example.com`. The OAuth issuer and the MCP address use it.
3. Run `npm run deploy`. It applies migration `0011_agent_access.sql`, which adds the tables for agents.

`wrangler.jsonc` must send these paths to the Worker first (`run_worker_first`): `/.well-known/*`, `/oauth/register`, `/oauth/token`, `/oauth/revoke`, `/mcp` and `/mcp/*`. The default file does. The consent page, `/oauth/authorize`, is part of the web app.

## Connect an agent

Give the agent the MCP address of the site: `https://app.example.com/mcp`.

1. The agent calls `/mcp` and gets a 401 answer. The answer names the resource metadata.
2. The agent reads the metadata, registers itself and sends the person to the consent page.
3. The person signs in with an email code, if they are not signed in yet.
4. The person picks a company and chooses **Allow changes** or not. Then they select **Connect**.
5. The agent gets tokens and calls the tools.

A person sees every connected agent in **Settings > Connected agents**. **Disconnect** stops an agent at once.

## What an agent can do

- **One company.** The person picks it on the consent page. To use another company, connect the agent again.
- **The person's role.** Before every call, the core checks the tool's permission, the app's on/off state and the plan, as for a person. When the person leaves the company, the agent stops.
- **Read, or read and change.** Without **Allow changes**, the agent can call only tools that only read (`mcp:read`). With it, the agent can also call tools that change data (`mcp:write`).
- **No deletes and no changes to people.** Apps do not offer these as tools. They need a person in the app.

## Endpoints

| Path | What it does |
| --- | --- |
| `/.well-known/oauth-authorization-server` | Authorization server metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) |
| `/.well-known/oauth-protected-resource` | Protected resource metadata for `/mcp` ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) |
| `/.well-known/mcp/server-card.json` | The MCP server card |
| `POST /oauth/register` | Client registration ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)). Public clients only, with no secret |
| `/oauth/authorize` | The consent page |
| `POST /oauth/token` | Codes and refresh tokens for tokens. PKCE with S256 is required |
| `POST /oauth/revoke` | Token revocation ([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009)). A refresh token disconnects the agent |
| `POST /mcp` | MCP for a connected agent: the tools the person can use |
| `POST /mcp/public` | MCP without sign-in: public tools only |

MCP runs over Streamable HTTP without sessions. Each POST holds one JSON-RPC message. The server offers tools: `initialize`, `ping`, `tools/list` and `tools/call`.

## Security

- Codes and tokens are stored only as SHA-256 hashes.
- An access token works for 1 hour. A refresh token works for 30 days. Each refresh gives a new refresh token, and the old one stops working.
- A code works once, for 10 minutes. When someone uses a code a second time, the core disconnects the agent.
- Redirect URIs must use https. Plain http works only on the loopback address, for apps on the person's computer.
- The consent page shows where the browser goes back to. An unregistered redirect URI gets an error page, never a redirect.
- One network can register 20 agents in an hour.
- The agent endpoints allow calls from any origin, because they use tokens, not cookies. The consent answer is an `/api` route, so it accepts only same-site requests with the session cookie.

## Give your app tools

An app lists its tools in `defineServerApp({ tools })`. See [Build an app](apps.md#tools-for-ai-agents).
