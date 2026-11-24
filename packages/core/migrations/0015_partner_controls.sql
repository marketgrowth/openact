-- Partner controls. See docs/partners.md.

-- One row for each partner that a super admin set up. A partner without a row uses the defaults:
-- it brings its own AI keys, and it is not paused.
CREATE TABLE partners (
  company_id         TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  -- 1: the partner and its client companies never use the site's own AI and keys. They bring their own.
  is_own_ai_required INTEGER NOT NULL DEFAULT 1,
  -- Set while the partner is paused. Its host shows a paused page, and every app is off in the partner company and
  -- in its client companies. Nothing is deleted. Null: not paused.
  paused_at          TEXT,
  paused_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at         TEXT NOT NULL
);

-- API keys for services other than the AI provider, such as TypeSafe (Jev). Encrypted like company_ai keys.
-- A client company of a partner uses its own key first, then the partner's key.
CREATE TABLE company_keys (
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  service     TEXT NOT NULL CHECK (service IN ('typesafe')),
  key_cipher  TEXT NOT NULL,
  key_hint    TEXT NOT NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (company_id, service)
);

-- Company owners can invite more owners. SQLite cannot change a CHECK, so the table is made again.
CREATE TABLE company_invitations_next (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  email      TEXT NOT NULL COLLATE NOCASE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  invited_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, email)
);
INSERT INTO company_invitations_next (id, company_id, email, role, invited_by, created_at)
  SELECT id, company_id, email, role, invited_by, created_at FROM company_invitations;
DROP TABLE company_invitations;
ALTER TABLE company_invitations_next RENAME TO company_invitations;
CREATE INDEX idx_company_invitations_email ON company_invitations (email);
