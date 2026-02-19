-- Run this in your Neon database to create all tables
-- If upgrading an existing DB, run the ALTER TABLE lines at the bottom

CREATE TABLE IF NOT EXISTS scripts (
  hash          TEXT PRIMARY KEY,
  label         TEXT DEFAULT 'Unnamed',
  content       TEXT,
  created_at    BIGINT,
  use_count     INT DEFAULT 0,
  last_used     BIGINT,
  usage_log     JSONB DEFAULT '[]',
  is_key_script BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public_scripts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  loadstring  TEXT NOT NULL,
  tags        TEXT[] DEFAULT '{}',
  image_data  TEXT,
  created_at  BIGINT,
  use_count   INT DEFAULT 0,
  last_used   BIGINT,
  usage_log   JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS script_keys (
  id               TEXT PRIMARY KEY,
  note             TEXT,
  expires_at       BIGINT,
  blacklisted      BOOLEAN DEFAULT FALSE,
  script_hash      TEXT,
  max_uses         INT,
  hwid             TEXT,
  use_count        INT DEFAULT 0,
  usage_log        JSONB DEFAULT '[]',
  known_usernames  JSONB DEFAULT '[]',
  created_at       BIGINT
);

CREATE TABLE IF NOT EXISTS security_log (
  id      SERIAL PRIMARY KEY,
  ts      BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  type    TEXT,
  details JSONB DEFAULT '{}'
);

-- If you already have the scripts table, run this to add the new column:
-- ALTER TABLE scripts ADD COLUMN IF NOT EXISTS is_key_script BOOLEAN DEFAULT FALSE;
