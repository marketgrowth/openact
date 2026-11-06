-- One table, prefixed with the app id. Every row belongs to a company.
CREATE TABLE hello_notes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX hello_notes_company ON hello_notes (company_id, created_at);
