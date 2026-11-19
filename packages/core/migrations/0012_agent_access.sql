-- Agent access: OAuth 2.1 for AI agents (MCP clients). See docs/agent-access.md.
-- Codes and tokens are stored only as SHA-256 hashes. Times are epoch milliseconds.

-- Agents that registered themselves (RFC 7591). Public clients: no secret.
CREATE TABLE oauth_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  client_uri    TEXT,
  redirect_uris TEXT NOT NULL, -- JSON array
  created_ip    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX idx_oauth_clients_ip ON oauth_clients (created_ip, created_at);

-- One person's approval of one agent in one company. Tokens hang from it; deleting it disconnects the agent.
CREATE TABLE oauth_grants (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES oauth_clients (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  scope        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_oauth_grants_user ON oauth_grants (user_id);
CREATE INDEX idx_oauth_grants_company ON oauth_grants (company_id, user_id);

CREATE TABLE oauth_codes (
  id             TEXT PRIMARY KEY, -- SHA-256 of the code
  grant_id       TEXT NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,
  used_at        INTEGER
);

CREATE TABLE oauth_tokens (
  id         TEXT PRIMARY KEY, -- SHA-256 of the token
  grant_id   TEXT NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE INDEX idx_oauth_tokens_expiry ON oauth_tokens (expires_at);
