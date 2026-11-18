-- eSign: templates with signer roles and fields on a PDF, documents sent for signature, signers and an audit log.
-- Every row belongs to one company. Deleting a company deletes its eSign data.
-- Files are in R2 under esign/<company id>/...

-- A template is a PDF with signer roles (such as Client and Company) and fields on its pages.
-- The PDF of a template never changes. A new PDF makes a new template.
CREATE TABLE esign_templates (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  file_key     TEXT NOT NULL,                  -- R2: esign/<company id>/t/<template id>.pdf
  file_name    TEXT NOT NULL,
  file_size    INTEGER NOT NULL,
  file_hash    TEXT NOT NULL,                  -- SHA-256 of the PDF, in hex
  pages        TEXT NOT NULL,                  -- JSON: [{ "w": points, "h": points }]
  roles        TEXT NOT NULL,                  -- JSON: [{ "id", "name" }]
  fields       TEXT NOT NULL,                  -- JSON: [{ "id", "roleId", "type", "page", "x", "y", "w", "h", "label", "required", "options" }]
  source_doc   TEXT,                           -- the Docs PDF it came from, when it came from Docs
  archived_at  TEXT,                           -- archived templates are hidden; documents sent from them keep working
  rev          INTEGER NOT NULL DEFAULT 1,     -- goes up on each save; a save with an old rev is refused
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_esign_templates_company ON esign_templates (company_id, archived_at, updated_at);

-- A document sent for signature. It keeps a copy of the template's roles and fields at send time,
-- so a later change to the template does not change a document that people are signing.
CREATE TABLE esign_submissions (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  template_id   TEXT REFERENCES esign_templates (id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  file_key      TEXT NOT NULL,                 -- the template's PDF
  file_name     TEXT NOT NULL,
  file_hash     TEXT NOT NULL,
  pages         TEXT NOT NULL,
  fields        TEXT NOT NULL,
  ordered       INTEGER NOT NULL DEFAULT 0,    -- 1: signers sign one after another; 0: all at the same time
  message       TEXT NOT NULL DEFAULT '',      -- the sender's note in the invitation email
  origin        TEXT NOT NULL DEFAULT '',      -- the app's address at send time, for links in emails that the daily job sends
  status        TEXT NOT NULL DEFAULT 'pending', -- pending, completed, declined or voided
  signed_key    TEXT,                          -- R2: the signed PDF with the signing certificate, when completed
  signed_size   INTEGER,
  signed_hash   TEXT,                          -- SHA-256 of the signed PDF, in hex
  finish_tries  INTEGER NOT NULL DEFAULT 0,    -- tries to build the signed PDF; the daily job retries up to 5
  docs_doc_id   TEXT,                          -- the copy saved in Docs, when there is one
  rev           INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT,
  voided_at     TEXT
);
CREATE INDEX idx_esign_submissions_company ON esign_submissions (company_id, status, created_at);
CREATE INDEX idx_esign_submissions_template ON esign_submissions (template_id);

-- One signer of a document, for one role. The signing link has a random token.
-- The token is stored as a hash, to find the signer, and sealed with AUTH_SECRET, to send reminders with the same link.
CREATE TABLE esign_submitters (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES esign_submissions (id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL,
  role_id        TEXT NOT NULL,
  role_name      TEXT NOT NULL,
  position       INTEGER NOT NULL,             -- the signing order, from 0
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  token_box      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'waiting', -- waiting, sent, opened, completed or declined
  field_values   TEXT NOT NULL DEFAULT '{}',   -- JSON: { field id: value }
  signature      TEXT,                         -- a PNG data URL, used on every signature field of this signer
  initials       TEXT,                         -- a PNG data URL, used on every initials field of this signer
  decline_reason TEXT,
  ip             TEXT,
  user_agent     TEXT,
  sent_at        TEXT,
  opened_at      TEXT,
  consented_at   TEXT,
  completed_at   TEXT,
  declined_at    TEXT,
  reminded_at    TEXT
);
CREATE INDEX idx_esign_submitters_submission ON esign_submitters (submission_id, position);

-- The audit log of a document. It goes on the signing certificate page of the signed PDF.
CREATE TABLE esign_events (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES esign_submissions (id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL,
  submitter_id   TEXT,
  kind           TEXT NOT NULL,                -- created, sent, opened, consented, signed, declined, reminded, completed, voided
  detail         TEXT NOT NULL DEFAULT '',
  ip             TEXT,
  user_agent     TEXT,
  at             TEXT NOT NULL
);
CREATE INDEX idx_esign_events_submission ON esign_events (submission_id, at);

-- Company settings for eSign.
CREATE TABLE esign_settings (
  company_id       TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  save_to_docs     INTEGER NOT NULL DEFAULT 1,   -- save each signed PDF to Docs, when Docs is on
  docs_folder_id   TEXT,                         -- the Docs folder for signed PDFs; null is the top of the library
  updated_at       TEXT NOT NULL
);

-- The revision of each company's eSign lists. It goes up when a template or a document changes,
-- so open pages load the lists again.
CREATE TABLE esign_state (
  company_id  TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL DEFAULT 0
);
