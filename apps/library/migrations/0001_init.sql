-- Library: a resource library for the whole site.
-- The site owns these rows, not a company. Only super admins manage them, and every company with the app on reads them.
-- So the tables have no company_id. `npm run sync` warns about each one. That is expected.

-- One row per list value. kind: type, topic or audience. Each site names the lists in its settings.
CREATE TABLE library_terms (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('type', 'topic', 'audience')),
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_hidden   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_library_terms_kind ON library_terms (kind, sort_order);

-- Automations add resources without a person: a feed, a video channel or a webhook.
-- kind: feed, video_channel, webhook. A webhook keeps only the hash of its key.
CREATE TABLE library_automations (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('feed', 'video_channel', 'webhook')),
  name              TEXT NOT NULL,
  url               TEXT NOT NULL DEFAULT '',
  feed_url          TEXT NOT NULL DEFAULT '',
  key_hash          TEXT,
  key_last4         TEXT NOT NULL DEFAULT '',
  every_minutes     INTEGER NOT NULL DEFAULT 60,
  terms_json        TEXT NOT NULL DEFAULT '[]',
  is_auto_publish   INTEGER NOT NULL DEFAULT 0,
  is_paused         INTEGER NOT NULL DEFAULT 0,
  fail_count        INTEGER NOT NULL DEFAULT 0,
  last_run_at       TEXT,
  last_error        TEXT NOT NULL DEFAULT '',
  created_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_library_automations_key_hash ON library_automations (key_hash);

-- Resources. format: document, link, video, article. status: draft, published, archived.
-- origin: person, feed, video_channel, webhook, agent. A file lives in R2 at file_key.
CREATE TABLE library_resources (
  id                TEXT PRIMARY KEY,
  format            TEXT NOT NULL CHECK (format IN ('document', 'link', 'video', 'article')),
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  source_url        TEXT NOT NULL DEFAULT '',
  image_url         TEXT NOT NULL DEFAULT '',
  site_name         TEXT NOT NULL DEFAULT '',
  video_provider    TEXT NOT NULL DEFAULT '',
  video_ref         TEXT NOT NULL DEFAULT '',
  file_key          TEXT,
  file_name         TEXT NOT NULL DEFAULT '',
  file_type         TEXT NOT NULL DEFAULT '',
  file_size         INTEGER NOT NULL DEFAULT 0,
  extracted_text    TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_featured       INTEGER NOT NULL DEFAULT 0,
  origin            TEXT NOT NULL DEFAULT 'person' CHECK (origin IN ('person', 'feed', 'video_channel', 'webhook', 'agent')),
  automation_id     TEXT REFERENCES library_automations (id) ON DELETE SET NULL,
  published_at      TEXT,
  created_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_library_resources_status ON library_resources (status, published_at);
CREATE INDEX idx_library_resources_source_url ON library_resources (source_url);

CREATE TABLE library_resource_terms (
  resource_id  TEXT NOT NULL REFERENCES library_resources (id) ON DELETE CASCADE,
  term_id      TEXT NOT NULL REFERENCES library_terms (id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, term_id)
);
CREATE INDEX idx_library_resource_terms_term ON library_resource_terms (term_id);

-- The Ask index: each resource's text in parts of about 300 words. Rebuilt on every save.
CREATE TABLE library_chunks (
  resource_id  TEXT NOT NULL REFERENCES library_resources (id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  text         TEXT NOT NULL,
  PRIMARY KEY (resource_id, seq)
);

-- The entries an automation has already taken, so a dismissed entry does not come back.
CREATE TABLE library_automation_entries (
  automation_id  TEXT NOT NULL REFERENCES library_automations (id) ON DELETE CASCADE,
  entry_url      TEXT NOT NULL,
  seen_at        TEXT NOT NULL,
  PRIMARY KEY (automation_id, entry_url)
);

-- One row per run of an automation, for the "Recent runs" log and the webhook rate limit.
CREATE TABLE library_runs (
  id             TEXT PRIMARY KEY,
  automation_id  TEXT NOT NULL REFERENCES library_automations (id) ON DELETE CASCADE,
  ran_at         TEXT NOT NULL,
  added_count    INTEGER NOT NULL DEFAULT 0,
  is_published   INTEGER NOT NULL DEFAULT 0,
  note           TEXT NOT NULL DEFAULT '',
  error          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_library_runs_automation ON library_runs (automation_id, ran_at);
CREATE INDEX idx_library_runs_ran ON library_runs (ran_at);

-- Site settings for the Library, one row per key. value_json holds the value.
CREATE TABLE library_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL
);
