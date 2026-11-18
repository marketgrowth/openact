-- CMS: the address of each company's EmDash site.
-- The web app shows the site's admin (<site_url>/_emdash/admin/) in a frame.
-- Deleting a company deletes its row.
CREATE TABLE cms_settings (
  company_id  TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  site_url    TEXT NOT NULL,                  -- cleaned by cleanSiteUrl: https, no query, no final slash
  updated_at  TEXT NOT NULL
);
