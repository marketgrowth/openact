-- WorkSpent schedules: the shifts a manager plans for each person at a location.
-- A new or changed shift is a draft. Staff see a shift only after a manager publishes it.
-- published_json keeps the version that staff see, so a change stays out of sight until it is published.

CREATE TABLE workspent_shifts (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  location_id     TEXT NOT NULL REFERENCES workspent_locations (id) ON DELETE CASCADE,
  person_id       TEXT REFERENCES workspent_people (id) ON DELETE CASCADE,  -- empty for an open shift
  starts_at       TEXT NOT NULL,                  -- ISO 8601 in UTC
  ends_at         TEXT NOT NULL,
  break_minutes   INTEGER NOT NULL DEFAULT 0,
  note            TEXT NOT NULL DEFAULT '',
  series_key      TEXT,                           -- shifts made by one weekly repeat share it
  published_json  TEXT,                           -- the published version: personId, startsAt, endsAt, breakMinutes, note
  is_deleted      INTEGER NOT NULL DEFAULT 0,     -- deleted after it was published. Publish removes it.
  published_at    TEXT,
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_workspent_shifts_location_starts ON workspent_shifts (location_id, starts_at);
CREATE INDEX idx_workspent_shifts_person_starts ON workspent_shifts (person_id, starts_at);
CREATE INDEX idx_workspent_shifts_company ON workspent_shifts (company_id);
