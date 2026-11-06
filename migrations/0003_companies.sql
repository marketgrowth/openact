-- Companies (tenants). Every project belongs to one company.
--
-- Company roles:
--   owner, admin  manage the company and every project that is visible to the company
--   member        sees every project that is visible to the company, as a viewer
--   guest         sees only the projects they are invited to
-- A project's visibility is "company" (all members see it) or "secret" (only its own members see it).
--
-- Upgrade rule: each project owner gets a company that holds their projects.
-- Everyone else becomes a guest, so nobody can see more than before the upgrade.

CREATE TABLE companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  logo_key        TEXT,                        -- R2 key of the logo image
  logo_type       TEXT,
  logo_updated_at TEXT,
  email_domain    TEXT UNIQUE COLLATE NOCASE,  -- People who sign in with this domain join as members
  ai_defaults     TEXT NOT NULL DEFAULT '{}',  -- The AI policy that new projects start with
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE company_members (
  company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX idx_company_members_user ON company_members (user_id);

CREATE TABLE company_invitations (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  email      TEXT NOT NULL COLLATE NOCASE,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, email)
);
CREATE INDEX idx_company_invitations_email ON company_invitations (email);

CREATE TABLE access_requests (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  decided_at TEXT
);
CREATE UNIQUE INDEX idx_access_requests_pending ON access_requests (project_id, user_id) WHERE status = 'pending';

ALTER TABLE projects ADD COLUMN company_id TEXT REFERENCES companies (id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'company' CHECK (visibility IN ('company', 'secret'));
CREATE INDEX idx_projects_company ON projects (company_id, updated_at);

ALTER TABLE users ADD COLUMN current_company_id TEXT;

-- The first owner of each project (by join date) holds it. Fall back to the creator.
-- Companies come first, because projects.company_id must point to a company that exists.
INSERT INTO companies (id, name, created_by, created_at, updated_at)
SELECT DISTINCT
  'c_' || u.id,
  CASE WHEN TRIM(u.name) = '' THEN 'My company' ELSE TRIM(u.name) || '''s company' END,
  u.id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT COALESCE(
    (SELECT m.user_id FROM project_members m WHERE m.project_id = p.id AND m.role = 'owner' ORDER BY m.created_at, m.user_id LIMIT 1),
    p.created_by
  ) AS owner_id
  FROM projects p
) o
JOIN users u ON u.id = o.owner_id;

-- A project with no owner and no creator gets no company. Only its own members can open it.
UPDATE projects SET company_id = 'c_' || COALESCE(
  (SELECT m.user_id FROM project_members m WHERE m.project_id = projects.id AND m.role = 'owner' ORDER BY m.created_at, m.user_id LIMIT 1),
  projects.created_by
)
WHERE 'c_' || COALESCE(
  (SELECT m.user_id FROM project_members m WHERE m.project_id = projects.id AND m.role = 'owner' ORDER BY m.created_at, m.user_id LIMIT 1),
  projects.created_by
) IN (SELECT id FROM companies);

INSERT INTO company_members (company_id, user_id, role, created_at)
SELECT id, created_by, 'owner', created_at FROM companies WHERE created_by IS NOT NULL;

INSERT OR IGNORE INTO company_members (company_id, user_id, role, created_at)
SELECT p.company_id, m.user_id, 'guest', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM project_members m
JOIN projects p ON p.id = m.project_id
WHERE p.company_id IS NOT NULL;

UPDATE users SET current_company_id = (
  SELECT cm.company_id FROM company_members cm
  WHERE cm.user_id = users.id
  ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, cm.created_at
  LIMIT 1
);
