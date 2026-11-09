-- Docs: a company library of paper-size documents, with folders, categories and tags.
-- Every row belongs to one company. Deleting a company deletes its library.

-- Folders nest up to 5 levels. The app deletes a folder only when it is empty.
-- The cascade on parent_id is for company deletion, when every folder goes at once.
CREATE TABLE docs_folders (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES docs_folders (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_docs_folders_company ON docs_folders (company_id, parent_id);

-- Categories say what kind of doc it is, such as Proposal or Policy. A doc has one category or none.
CREATE TABLE docs_categories (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'slate',   -- a project color token: indigo, teal, amber, rose, violet or slate
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_docs_categories_name ON docs_categories (company_id, name COLLATE NOCASE);

-- Tags are free labels. Editors make them by typing a new name. A doc has up to 20.
CREATE TABLE docs_tags (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_docs_tags_name ON docs_tags (company_id, name COLLATE NOCASE);

CREATE TABLE docs_docs (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  folder_id   TEXT REFERENCES docs_folders (id) ON DELETE SET NULL,      -- null: not in a folder
  category_id TEXT REFERENCES docs_categories (id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,                     -- Tiptap JSON, cleaned by the Worker before it is saved
  page_size   TEXT NOT NULL DEFAULT 'letter',    -- letter, a4 or legal
  orientation TEXT NOT NULL DEFAULT 'portrait',  -- portrait or landscape
  margin      TEXT NOT NULL DEFAULT 'normal',    -- narrow, normal or wide
  rev         INTEGER NOT NULL DEFAULT 1,        -- Goes up on each save of the content. A save with an old rev is refused.
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_docs_docs_company ON docs_docs (company_id, updated_at);
CREATE INDEX idx_docs_docs_folder ON docs_docs (folder_id);
CREATE INDEX idx_docs_docs_category ON docs_docs (category_id);

CREATE TABLE docs_doc_tags (
  doc_id  TEXT NOT NULL REFERENCES docs_docs (id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES docs_tags (id) ON DELETE CASCADE,
  PRIMARY KEY (doc_id, tag_id)
);
CREATE INDEX idx_docs_doc_tags_tag ON docs_doc_tags (tag_id);

-- The library's revision. It goes up when docs, folders, categories or tags change, so open pages load the lists again.
CREATE TABLE docs_library (
  company_id  TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL DEFAULT 0
);

-- One share link per doc. The token is never stored in plain text:
-- token_hash (SHA-256) finds the doc, and token_box (encrypted with AUTH_SECRET) lets people copy the link again.
CREATE TABLE docs_shares (
  doc_id      TEXT PRIMARY KEY REFERENCES docs_docs (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  token_box   TEXT NOT NULL,
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

-- Images in docs, stored in R2 under docs/<company id>/<doc id>/<file id>.
-- No foreign key to docs_docs: when a doc is deleted, its files go from R2 first, then these rows.
CREATE TABLE docs_files (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  doc_id       TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  uploaded_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_docs_files_doc ON docs_files (doc_id);
CREATE INDEX idx_docs_files_company ON docs_files (company_id);
