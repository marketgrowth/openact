-- Settings for this deploy, such as its name and logo. A super admin sets them.
-- Keys: app_name, logo_type, logo_updated_at. The logo file is in R2 at site/logo.
-- A missing key means the default: APP_NAME, and the OpenAct mark.
CREATE TABLE site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
