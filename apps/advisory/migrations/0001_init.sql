-- Advisory: a company marketplace of approved advisors. Members hire advisors, or apply to become one.
-- Payments go through Stripe Connect. A paid engagement opens a project in the Projects app.

-- The brand's settings. One row per company. Missing row: the defaults.
CREATE TABLE IF NOT EXISTS advisory_settings (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT,
  label_plural TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'required',
  default_fee_bps INTEGER NOT NULL DEFAULT 1500,
  currency TEXT NOT NULL DEFAULT 'usd',
  updated_at TEXT NOT NULL
);

-- One advisor profile per person per company.
-- status: draft, pending (waiting for review), approved (listed), paused (hidden by the brand), declined.
-- fee_bps: the brand fee on each payment, in basis points (1500 = 15%).
CREATE TABLE IF NOT EXISTS advisory_advisors (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  headline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  photo_type TEXT,
  fee_bps INTEGER NOT NULL DEFAULT 1500,
  stripe_account_id TEXT,
  stripe_ready INTEGER NOT NULL DEFAULT 0,
  decline_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS advisory_advisors_company ON advisory_advisors (company_id, status);
CREATE INDEX IF NOT EXISTS advisory_advisors_stripe ON advisory_advisors (stripe_account_id);

-- What an advisor sells. kind: one_time or retainer (monthly). status: active or archived.
-- An archived offer stays, so old requests and engagements keep their link.
CREATE TABLE IF NOT EXISTS advisory_offers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  advisor_id TEXT NOT NULL REFERENCES advisory_advisors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS advisory_offers_advisor ON advisory_offers (advisor_id, status);

-- A consultation request, or a direct purchase (source = 'direct').
-- status: pending, accepted (waiting for payment), declined, canceled, paid.
-- The terms_* columns copy the agreed name, price and kind when the advisor accepts.
CREATE TABLE IF NOT EXISTS advisory_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  advisor_id TEXT NOT NULL REFERENCES advisory_advisors(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'request',
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT NOT NULL DEFAULT '',
  offer_id TEXT,
  terms_name TEXT,
  terms_price_cents INTEGER,
  terms_currency TEXT,
  terms_kind TEXT,
  fee_bps INTEGER,
  decline_note TEXT NOT NULL DEFAULT '',
  stripe_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS advisory_requests_advisor ON advisory_requests (advisor_id, status);
CREATE INDEX IF NOT EXISTS advisory_requests_client ON advisory_requests (company_id, client_id);

-- A paid request. One per request. status: active or ended (a retainer that stopped).
CREATE TABLE IF NOT EXISTS advisory_engagements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE REFERENCES advisory_requests(id) ON DELETE CASCADE,
  advisor_id TEXT NOT NULL REFERENCES advisory_advisors(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_name TEXT NOT NULL,
  terms_price_cents INTEGER NOT NULL,
  terms_currency TEXT NOT NULL,
  terms_kind TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_subscription_id TEXT,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS advisory_engagements_advisor ON advisory_engagements (advisor_id, created_at);
CREATE INDEX IF NOT EXISTS advisory_engagements_client ON advisory_engagements (company_id, client_id);
CREATE INDEX IF NOT EXISTS advisory_engagements_subscription ON advisory_engagements (stripe_subscription_id);
