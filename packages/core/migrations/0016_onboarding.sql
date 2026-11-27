-- Onboarding: the legal name and the type of a company.
-- legal_name is the official name, as on the company's filings. companies.name stays the name that shows in the app.
-- entity_type: corporation, llc, sole_proprietorship, partnership, nonprofit or other. Null for companies made before onboarding.
-- The site setting onboarding_enabled lives in site_settings. A missing key means on.

ALTER TABLE companies ADD COLUMN legal_name TEXT;
ALTER TABLE companies ADD COLUMN entity_type TEXT
  CHECK (entity_type IS NULL OR entity_type IN ('corporation', 'llc', 'sole_proprietorship', 'partnership', 'nonprofit', 'other'));
