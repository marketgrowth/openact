-- Workspaces: named slices of a company's work, such as brands, business units, locations or regions.
-- Workspaces are flat. They use the company roles. Every company has exactly one default workspace.
-- Apps that declare "scope": "workspace" in their manifest keep a workspace_id on their rows.
-- Other apps stay company-wide. Workspaces are archived, never deleted, so app data inside them stays.

CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'brand'
                  CHECK (kind IN ('brand', 'business_unit', 'location', 'region')),
  is_default      INTEGER NOT NULL DEFAULT 0,
  logo_key        TEXT,                        -- R2 key of the logo. Without one, the company logo shows.
  logo_type       TEXT,
  logo_updated_at TEXT,
  colors          TEXT NOT NULL DEFAULT '{}',  -- JSON, such as {"primary":"#1f2937","accent":"#c99a2e"}
  website         TEXT,
  archived_at     TEXT,                        -- Set when an owner or admin archives the workspace. Null: active.
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (company_id, slug)
);
CREATE UNIQUE INDEX idx_workspaces_default ON workspaces (company_id) WHERE is_default = 1;
CREATE INDEX idx_workspaces_company ON workspaces (company_id, archived_at);

-- The workspace the person has open: a workspace id, or 'all' for an owner or admin.
-- A value that does not belong to the current company means that company's default workspace.
ALTER TABLE users ADD COLUMN current_workspace_id TEXT;

-- Every new company gets its default workspace, however the company is made (create, duplicate, upgrade).
CREATE TRIGGER companies_default_workspace AFTER INSERT ON companies
BEGIN
  INSERT INTO workspaces (id, company_id, name, slug, kind, is_default, created_by, created_at, updated_at)
  VALUES (lower(hex(randomblob(16))), NEW.id, NEW.name, 'main', 'brand', 1, NEW.created_by, NEW.created_at, NEW.created_at);
END;

-- Backfill: one default workspace for each company that exists today.
INSERT INTO workspaces (id, company_id, name, slug, kind, is_default, created_by, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, name, 'main', 'brand', 1, created_by, created_at, created_at FROM companies;

UPDATE users SET current_workspace_id = (
  SELECT w.id FROM workspaces w WHERE w.company_id = users.current_company_id AND w.is_default = 1
) WHERE current_company_id IS NOT NULL;
