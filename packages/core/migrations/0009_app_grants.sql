-- Paid apps that a super admin gives to one person, without a paid plan.
-- A grant unlocks the app in every company where that person is an owner.
-- The grant stops when the person stops being an owner, when it ends, or when a super admin removes it.
CREATE TABLE app_grants (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app_id     TEXT NOT NULL,
  ends_on    TEXT,                                 -- The last day of the grant (YYYY-MM-DD, UTC). NULL: no end.
  granted_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);
CREATE INDEX idx_app_grants_app ON app_grants (app_id);
