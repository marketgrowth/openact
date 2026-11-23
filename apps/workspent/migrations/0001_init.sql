-- WorkSpent: a time clock. It keeps hours only. Pay, pay rates and taxes stay with the payroll provider.
-- Hours are not stored. The app works them out from the punches, so a fix changes the hours at once.
-- Every row has company_id. Deleting a company deletes its rows (companyDeleting hook and ON DELETE CASCADE).

-- A place or a team that hours belong to, such as a care home.
CREATE TABLE workspent_locations (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  time_zone          TEXT NOT NULL,                     -- an IANA name, such as America/Los_Angeles
  clock_rule         TEXT NOT NULL DEFAULT 'on_site',   -- on_site (remote comes in a later release)
  period_kind        TEXT NOT NULL DEFAULT 'biweekly',  -- weekly, biweekly or semimonthly
  period_start_date  TEXT NOT NULL,                     -- the first day of one pay period (weekly and biweekly)
  flags_json         TEXT NOT NULL DEFAULT '{}',        -- flag limits: dayHours, weekHours, mealAfterHours, missedOutHours
  source_app         TEXT,                              -- the app that made this location through the service, such as directcare
  source_key         TEXT,                              -- that app's own key for it
  is_archived        INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_workspent_locations_company ON workspent_locations (company_id);
CREATE UNIQUE INDEX idx_workspent_locations_company_source ON workspent_locations (company_id, source_app, source_key);

-- People who can manage one location only, such as a house manager. They need no workspent.manage permission.
CREATE TABLE workspent_location_managers (
  location_id  TEXT NOT NULL REFERENCES workspent_locations (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (location_id, user_id)
);
CREATE INDEX idx_workspent_location_managers_company_user ON workspent_location_managers (company_id, user_id);

-- A tablet or a computer that shows the PIN pad for one location.
-- The device keeps its key in the browser. The server keeps only a hash of it.
CREATE TABLE workspent_devices (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  location_id      TEXT NOT NULL REFERENCES workspent_locations (id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,                 -- tablet or computer
  key_hash         TEXT NOT NULL,                 -- SHA-256 of the device key. Empty after Switch off.
  last_seen_at     TEXT,
  last_ip_address  TEXT,
  wrong_pin_count  INTEGER NOT NULL DEFAULT 0,    -- wrong PINs in a row on this device
  locked_until_ms  INTEGER,                       -- the PIN pad is locked until this time (epoch ms)
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_workspent_devices_location ON workspent_devices (location_id);
CREATE INDEX idx_workspent_devices_company ON workspent_devices (company_id);

-- Someone whose hours are tracked. A person can have an OpenAct account (user_id) or not.
CREATE TABLE workspent_people (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  user_id      TEXT REFERENCES users (id) ON DELETE SET NULL,
  pin_hash     TEXT,                                -- HMAC of the PIN with the server secret. Never the PIN.
  pin_set_at   TEXT,
  source_app   TEXT,
  source_key   TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_workspent_people_company ON workspent_people (company_id);
CREATE UNIQUE INDEX idx_workspent_people_company_user ON workspent_people (company_id, user_id);
CREATE UNIQUE INDEX idx_workspent_people_company_source ON workspent_people (company_id, source_app, source_key);

-- Which people clock in at which locations.
CREATE TABLE workspent_person_locations (
  person_id    TEXT NOT NULL REFERENCES workspent_people (id) ON DELETE CASCADE,
  location_id  TEXT NOT NULL REFERENCES workspent_locations (id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, location_id)
);
CREATE INDEX idx_workspent_person_locations_location ON workspent_person_locations (location_id);

-- One clock event: in, break_start, break_end or out.
CREATE TABLE workspent_punches (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL REFERENCES workspent_people (id) ON DELETE CASCADE,
  location_id   TEXT NOT NULL REFERENCES workspent_locations (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                  -- in, break_start, break_end or out
  punched_at    TEXT NOT NULL,                  -- the time of the event, ISO 8601 in UTC
  source        TEXT NOT NULL,                  -- device, phone, computer or manager
  device_id     TEXT REFERENCES workspent_devices (id) ON DELETE SET NULL,
  ip_address    TEXT,
  is_late_sync  INTEGER NOT NULL DEFAULT 0,     -- a device was offline and sent it later
  is_deleted    INTEGER NOT NULL DEFAULT 0,     -- a manager deleted it. It stays, crossed out.
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  received_at   TEXT NOT NULL
);
CREATE INDEX idx_workspent_punches_location_punched ON workspent_punches (location_id, punched_at);
CREATE INDEX idx_workspent_punches_person_punched ON workspent_punches (person_id, punched_at);
CREATE INDEX idx_workspent_punches_company ON workspent_punches (company_id);

-- The audit trail of manager fixes. The person can confirm or question each one.
CREATE TABLE workspent_changes (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  punch_id       TEXT NOT NULL REFERENCES workspent_punches (id) ON DELETE CASCADE,
  person_id      TEXT NOT NULL REFERENCES workspent_people (id) ON DELETE CASCADE,
  location_id    TEXT NOT NULL REFERENCES workspent_locations (id) ON DELETE CASCADE,
  action         TEXT NOT NULL,                 -- add, change or delete
  old_json       TEXT,                          -- the punch before the fix
  new_json       TEXT,                          -- the punch after the fix
  reason         TEXT NOT NULL,
  changed_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  changed_at     TEXT NOT NULL,
  response       TEXT,                          -- confirmed or questioned, from the person
  response_note  TEXT,
  responded_at   TEXT
);
CREATE INDEX idx_workspent_changes_punch ON workspent_changes (punch_id);
CREATE INDEX idx_workspent_changes_person ON workspent_changes (person_id);
CREATE INDEX idx_workspent_changes_company ON workspent_changes (company_id);

-- Pay periods that a manager approved. A period without a row is open.
CREATE TABLE workspent_periods (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  location_id  TEXT NOT NULL REFERENCES workspent_locations (id) ON DELETE CASCADE,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  status       TEXT NOT NULL,                   -- approved or open (open after a reopen)
  approved_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  approved_at  TEXT,
  reopened_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  reopened_at  TEXT
);
CREATE UNIQUE INDEX idx_workspent_periods_location_start ON workspent_periods (location_id, start_date);
CREATE INDEX idx_workspent_periods_company ON workspent_periods (company_id);
