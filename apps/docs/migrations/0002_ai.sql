-- Docs settings for each company. AI writing help is off until a company owner or admin turns it on,
-- because it sends doc text to the company's AI provider.
CREATE TABLE docs_settings (
  company_id  TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  ai_enabled  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
