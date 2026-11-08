-- The AI agent of a company. A company owner sets it in Company settings, on the AI provider tab.
-- Without a row, the company uses the deploy default (AI_PROVIDER and AI_MODEL).
-- key_cipher holds the API key, encrypted with AES-GCM. The key comes from AUTH_SECRET and the company id.
-- key_hint holds the last 4 characters of the key, so people can tell which key is saved.
CREATE TABLE company_ai (
  company_id TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  key_cipher TEXT NOT NULL,
  key_hint   TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
