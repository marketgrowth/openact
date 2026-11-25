-- WorkSpent: the Projects kind of work. Time on projects for clients, with rates and weekly approval.
-- Projects and tasks come from the core tables of the Projects app. Entries keep no foreign key to them,
-- so deleting a project never deletes hours that a client approved.

CREATE TABLE workspent_settings (
  company_id       TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  kinds_json       TEXT,                       -- {"projects":true,"shifts":true}. NULL: the site default.
  currency         TEXT NOT NULL DEFAULT 'USD',
  rounding_minutes INTEGER NOT NULL DEFAULT 0, -- 0, 6 or 15
  updated_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE workspent_clients (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  approver_name  TEXT NOT NULL DEFAULT '',
  approver_email TEXT NOT NULL DEFAULT '',     -- Empty: a manager approves this client's hours.
  rate_cents     INTEGER,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_workspent_clients_company ON workspent_clients (company_id, is_archived);

-- WorkSpent's settings for one project of the Projects app.
CREATE TABLE workspent_projects (
  project_id     TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  client_id      TEXT REFERENCES workspent_clients (id),
  rate_cents     INTEGER,
  budget_minutes INTEGER,
  is_billable    INTEGER NOT NULL DEFAULT 1,
  is_tracked     INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_workspent_projects_company ON workspent_projects (company_id);

CREATE TABLE workspent_members (
  company_id     TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff', 'freelancer')),
  rate_cents     INTEGER,
  weekly_minutes INTEGER,                      -- Hours planned each week, for My time.
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE workspent_entries (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL,
  task_id          TEXT,
  client_id        TEXT REFERENCES workspent_clients (id),
  work_date        TEXT NOT NULL,
  week_start_date  TEXT NOT NULL,               -- The Sunday of work_date's week.
  minutes          INTEGER NOT NULL DEFAULT 0,
  timer_started_ms INTEGER,                     -- Set while the timer runs.
  note             TEXT NOT NULL DEFAULT '',
  is_billable      INTEGER NOT NULL DEFAULT 1,
  rate_cents       INTEGER,                     -- Saved when the week is approved.
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_workspent_entries_user_week ON workspent_entries (company_id, user_id, week_start_date);
CREATE INDEX idx_workspent_entries_company_date ON workspent_entries (company_id, work_date);
CREATE INDEX idx_workspent_entries_project ON workspent_entries (company_id, project_id);
CREATE UNIQUE INDEX idx_workspent_entries_one_timer ON workspent_entries (company_id, user_id) WHERE timer_started_ms IS NOT NULL;

-- One person's week for one client (or for no client). No row: not sent.
CREATE TABLE workspent_weeks (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start_date    TEXT NOT NULL,
  client_id          TEXT REFERENCES workspent_clients (id),
  status             TEXT NOT NULL CHECK (status IN ('sent', 'approved', 'returned')),
  note               TEXT NOT NULL DEFAULT '',
  sent_at            TEXT,
  decided_at         TEXT,
  decided_by         TEXT REFERENCES users (id) ON DELETE SET NULL,
  is_client_decision INTEGER NOT NULL DEFAULT 0,
  link_hash          TEXT,
  link_expires_ms    INTEGER,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_workspent_weeks_part ON workspent_weeks (company_id, user_id, week_start_date, COALESCE(client_id, ''));
CREATE UNIQUE INDEX idx_workspent_weeks_link ON workspent_weeks (link_hash) WHERE link_hash IS NOT NULL;
