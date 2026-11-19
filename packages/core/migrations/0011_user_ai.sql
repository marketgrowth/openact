-- A person's own AI. Each person can set it in Personal account > My AI.
-- It replaces the company AI and the deploy default for that person's requests, when the company allows member keys.
-- key_cipher holds the API key, encrypted with AES-GCM. The key comes from AUTH_SECRET and the user id.
-- key_hint holds the last 4 characters of the key, so the person can tell which key is saved.
CREATE TABLE user_ai (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  key_cipher TEXT NOT NULL,
  key_hint   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 1: members can use their own AI key in this company (the default). 0: the company AI or the deploy default always runs.
ALTER TABLE companies ADD COLUMN ai_member_keys INTEGER NOT NULL DEFAULT 1;
