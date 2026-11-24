-- Partner domains: white label for agencies and other partners. See docs/partners.md.
-- A super admin points a host name, such as app.brightline.com, at one company: the partner.
-- On that host, the sign-in page, the app name, the logo and the emails show the partner, not the site.
-- Companies that the partner's owners and admins make on their host are the partner's client companies.

CREATE TABLE partner_domains (
  host        TEXT PRIMARY KEY,               -- Lowercase host name, with no scheme, port or path.
  company_id  TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name        TEXT,                           -- The name people see on this host. Null: the company name.
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_partner_domains_company ON partner_domains (company_id);

-- The partner that made this company, or null. It organizes and counts client companies. It never gives access:
-- the partner's people see a client company only when they are its members.
ALTER TABLE companies ADD COLUMN partner_id TEXT REFERENCES companies (id) ON DELETE SET NULL;
CREATE INDEX idx_companies_partner ON companies (partner_id);
