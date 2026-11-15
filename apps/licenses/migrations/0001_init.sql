-- License Keys app. Site-wide, not per company: only super admins use it.

-- Ed25519 key pairs that sign license keys. The private key never leaves this deploy.
CREATE TABLE licenses_signing_keys (
  kid         TEXT PRIMARY KEY,               -- The key id, such as mg-2026. It goes into each license.
  public_key  TEXT NOT NULL,                  -- Raw public key, base64url. Paste it into license-keys.ts.
  private_box TEXT NOT NULL,                  -- PKCS#8 private key, sealed with AUTH_SECRET (sealSecret, purpose licenses-signing).
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  retired_at  TEXT                            -- A retired key signs no new licenses.
);

-- Every license key that this app issued.
CREATE TABLE licenses_keys (
  id         TEXT PRIMARY KEY,                -- The license id in the payload, such as lic_20261115_ab12cd34.
  kid        TEXT NOT NULL REFERENCES licenses_signing_keys (kid),
  licensee   TEXT NOT NULL,
  plan       TEXT NOT NULL,                   -- director or producer
  key_use    TEXT NOT NULL,                   -- plan or grants
  hosts      TEXT NOT NULL DEFAULT '[]',      -- JSON array of host names. Empty: any host.
  issued_at  TEXT NOT NULL,                   -- YYYY-MM-DD
  expires_at TEXT NOT NULL,                   -- YYYY-MM-DD
  note       TEXT NOT NULL DEFAULT '',
  license    TEXT NOT NULL,                   -- The full key, oa1.<payload>.<signature>
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_licenses_keys_created ON licenses_keys (created_at);
