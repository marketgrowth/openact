-- Apps per company, and the roles that have each app permission.
-- A row exists only when a company changed something. Without a row, the app uses its defaults.
CREATE TABLE company_apps (
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  app_id      TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  permissions TEXT NOT NULL DEFAULT '{}', -- {"projects.create": ["owner", "admin"]}
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (company_id, app_id)
);
