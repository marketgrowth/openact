-- Apps that a super admin turned off for one company.
-- A row means the app is not available in that company. The company's owners and admins cannot turn it on.
-- The app keeps its data. Removing the row makes the app available again, with the company's own switch.
CREATE TABLE company_app_blocks (
  company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  app_id     TEXT NOT NULL,
  blocked_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (company_id, app_id)
);
