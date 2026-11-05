-- OpenAct initial schema.
-- Times stored as ISO 8601 text are for display. Times stored as INTEGER are epoch milliseconds for expiry checks.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE login_codes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  code_hash  TEXT NOT NULL,
  ip         TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX idx_login_codes_email ON login_codes (email, created_at);
CREATE INDEX idx_login_codes_ip ON login_codes (ip, created_at);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY, -- SHA-256 of the cookie token. The token itself is never stored.
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT 'indigo',
  rev         INTEGER NOT NULL DEFAULT 1, -- Goes up on every change. Clients poll it to stay in sync.
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_members_user ON project_members (user_id);

CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  email       TEXT NOT NULL COLLATE NOCASE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (project_id, email)
);
CREATE INDEX idx_invitations_email ON invitations (email);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'doing', 'review', 'done')),
  priority    TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('high', 'med', 'low')),
  phase       TEXT NOT NULL DEFAULT '',
  start_date  TEXT,
  end_date    TEXT,
  assignee_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_tasks_project ON tasks (project_id, status, sort_order);

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id      TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  uploaded_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_attachments_task ON attachments (task_id);
CREATE INDEX idx_attachments_project ON attachments (project_id);
