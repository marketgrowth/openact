-- Paid plans per company, from a Stripe annual subscription.
-- A row exists only when a company bought a plan on this deploy. Without a row, the company is on the free plan,
-- unless the deploy has a license key (OPENACT_LICENSE).
CREATE TABLE company_plans (
  company_id             TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL,            -- director or producer
  status                 TEXT NOT NULL,            -- the Stripe subscription status, such as active or canceled
  period_end             TEXT,                     -- the end of the paid year, as an ISO time
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  updated_at             TEXT NOT NULL
);
