-- Comment threads on docs. A thread can point at text in the doc (a "comment" mark with the thread id),
-- or be about the whole doc. Deleting a doc deletes its threads.
CREATE TABLE docs_threads (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  doc_id       TEXT NOT NULL REFERENCES docs_docs (id) ON DELETE CASCADE,
  quote        TEXT,                              -- The text the thread points at, as it was then. NULL for a comment on the whole doc.
  status       TEXT NOT NULL DEFAULT 'open',      -- open or resolved
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  resolved_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  resolved_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_docs_threads_doc ON docs_threads (doc_id, created_at);

CREATE TABLE docs_comments (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES docs_threads (id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  body        TEXT NOT NULL,                      -- Plain text. The web app shows it as text, with links.
  created_at  TEXT NOT NULL,
  edited_at   TEXT
);
CREATE INDEX idx_docs_comments_thread ON docs_comments (thread_id, created_at);

-- Goes up when a thread or comment of the doc changes, so open comment panels load again.
-- Apart from rev, so comments never clash with saves of the doc's content.
ALTER TABLE docs_docs ADD COLUMN comments_rev INTEGER NOT NULL DEFAULT 0;
