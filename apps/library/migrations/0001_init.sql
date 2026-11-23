-- Library: one body of reference content for the whole site.
-- The site owns these rows, not a company. Only super admins write them, and every company with the app on reads them.
-- So the content tables have no company_id. `npm run sync` warns about each one. That is expected.
-- Readers see only the newest row of library_versions for each item that is not archived. An edit stays a draft until it is published.

-- One row per list item. kind: category, audience or topic. Each site names the lists in its settings.
CREATE TABLE library_terms (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('category', 'audience', 'topic')),
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_hidden   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_library_terms_kind ON library_terms (kind, sort_order);

-- Sources: the working copy that super admins edit. status: draft, in_review, published, archived.
CREATE TABLE library_sources (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  citation           TEXT NOT NULL DEFAULT '',
  summary            TEXT NOT NULL DEFAULT '',
  details            TEXT NOT NULL DEFAULT '',
  source_url         TEXT NOT NULL DEFAULT '',
  last_checked_date  TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'published', 'archived')),
  review_note        TEXT NOT NULL DEFAULT '',
  submitted_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_by         TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by         TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_library_sources_status ON library_sources (status, updated_at);

CREATE TABLE library_source_terms (
  source_id  TEXT NOT NULL REFERENCES library_sources (id) ON DELETE CASCADE,
  term_id    TEXT NOT NULL REFERENCES library_terms (id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, term_id)
);

-- Updates: what changed, who it affects, what to do by when. Same status steps as sources.
CREATE TABLE library_updates (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  what_changed     TEXT NOT NULL DEFAULT '',
  who_affected     TEXT NOT NULL DEFAULT '',
  action           TEXT NOT NULL DEFAULT '',
  action_due_date  TEXT,
  source_url       TEXT NOT NULL DEFAULT '',
  published_date   TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'published', 'archived')),
  review_note      TEXT NOT NULL DEFAULT '',
  submitted_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_library_updates_status ON library_updates (status, updated_at);

CREATE TABLE library_update_terms (
  update_id  TEXT NOT NULL REFERENCES library_updates (id) ON DELETE CASCADE,
  term_id    TEXT NOT NULL REFERENCES library_terms (id) ON DELETE CASCADE,
  PRIMARY KEY (update_id, term_id)
);

-- The sources that an update changes.
CREATE TABLE library_update_sources (
  update_id  TEXT NOT NULL REFERENCES library_updates (id) ON DELETE CASCADE,
  source_id  TEXT NOT NULL REFERENCES library_sources (id) ON DELETE CASCADE,
  PRIMARY KEY (update_id, source_id)
);

-- The published copies. The newest version of an item is what readers see.
-- item_kind: source or update. snapshot_json holds the published fields and the term and source ids.
CREATE TABLE library_versions (
  item_kind      TEXT NOT NULL CHECK (item_kind IN ('source', 'update')),
  item_id        TEXT NOT NULL,
  version        INTEGER NOT NULL,
  snapshot_json  TEXT NOT NULL,
  published_by   TEXT REFERENCES users (id) ON DELETE SET NULL,  -- the reviewer who published it
  published_at   TEXT NOT NULL,
  PRIMARY KEY (item_kind, item_id, version)
);

-- Brand settings: the page title, the names, the list labels, the notice, the review checklist.
CREATE TABLE library_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL
);
