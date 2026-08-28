CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, title text NOT NULL DEFAULT '', excerpt text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS note_updates (
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE, seq bigserial,
  update bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(note_id, seq)
);
CREATE TABLE IF NOT EXISTS note_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), state bytea NOT NULL, excerpt text NOT NULL DEFAULT ''
);
ALTER TABLE note_snapshots ADD COLUMN IF NOT EXISTS up_to_seq bigint;
