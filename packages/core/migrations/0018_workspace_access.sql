-- Workspaces limit what a member sees. A row means this person works in this workspace.
-- Owners and admins see every workspace, so they need no row. Guests see what they are invited to.
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_workspace_members_user ON workspace_members (user_id, company_id);

-- Nobody loses access on upgrade: every current member joins every current workspace.
INSERT INTO workspace_members (workspace_id, company_id, user_id, created_at)
  SELECT w.id, m.company_id, m.user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM company_members m JOIN workspaces w ON w.company_id = m.company_id
  WHERE m.role = 'member';

-- Members can invite people into a workspace they are in. A company can turn this off.
ALTER TABLE companies ADD COLUMN member_invites INTEGER NOT NULL DEFAULT 1;
