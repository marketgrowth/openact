-- Invitations need consent, a level, an optional workspace and an expiry date.
-- SQLite cannot add a NOT NULL column with a computed default, so the table is made again.
CREATE TABLE company_invitations_next (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  email        TEXT NOT NULL COLLATE NOCASE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  level        TEXT NOT NULL DEFAULT 'company' CHECK (level IN ('site', 'company', 'workspace')),
  workspace_id TEXT REFERENCES workspaces (id) ON DELETE CASCADE, -- Null means the default workspace.
  invited_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  UNIQUE (company_id, email)
);
-- Invitations that exist today get 14 days from the upgrade.
INSERT INTO company_invitations_next (id, company_id, email, role, level, workspace_id, invited_by, created_at, expires_at)
  SELECT id, company_id, email, role, 'company', NULL, invited_by, created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days') FROM company_invitations;
DROP TABLE company_invitations;
ALTER TABLE company_invitations_next RENAME TO company_invitations;
CREATE INDEX idx_company_invitations_email ON company_invitations (email);

-- Accepted and declined invitations leave no row, so the daily limit counts this log instead.
CREATE TABLE invitation_log (
  id         TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies (id) ON DELETE CASCADE,
  invited_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  level      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_invitation_log_company ON invitation_log (company_id, created_at);
CREATE INDEX idx_invitation_log_inviter ON invitation_log (invited_by, created_at);
