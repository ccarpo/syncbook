CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE notes ADD COLUMN IF NOT EXISTS content text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_notes_content_trgm
  ON notes USING GIN ((COALESCE(title, '') || ' ' || COALESCE(content, '')) gin_trgm_ops);
