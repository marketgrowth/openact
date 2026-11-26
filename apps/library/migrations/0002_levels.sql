-- Library version 2, part 1: three levels.
-- vault: the site's Content Vault of templates. Site owners manage it. Members never see it. Every version 1 resource becomes a vault row.
-- company: a company's own library. Company owners manage it. Every member of the company reads its published rows.
-- personal: a person's private items in My Library, inside one company. Only that person sees them.

ALTER TABLE library_resources ADD COLUMN scope TEXT NOT NULL DEFAULT 'vault' CHECK (scope IN ('vault', 'company', 'personal'));
ALTER TABLE library_resources ADD COLUMN company_id TEXT REFERENCES companies (id) ON DELETE CASCADE;
ALTER TABLE library_resources ADD COLUMN owner_user_id TEXT REFERENCES users (id) ON DELETE CASCADE;
CREATE INDEX idx_library_resources_company ON library_resources (company_id, scope, status);
CREATE INDEX idx_library_resources_owner ON library_resources (company_id, owner_user_id);

-- List values: company_id is null for the vault's lists. A company gets its own copy of them.
ALTER TABLE library_terms ADD COLUMN company_id TEXT REFERENCES companies (id) ON DELETE CASCADE;
CREATE INDEX idx_library_terms_company ON library_terms (company_id, kind, sort_order);

-- Bookmarks: a person saves a company resource to My Library.
CREATE TABLE library_bookmarks (
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  resource_id  TEXT NOT NULL REFERENCES library_resources (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, resource_id)
);
CREATE INDEX idx_library_bookmarks_company_user ON library_bookmarks (company_id, user_id, created_at);

-- A company's Library Settings, one row per key. Missing keys take the site's value.
CREATE TABLE library_company_settings (
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (company_id, key)
);
