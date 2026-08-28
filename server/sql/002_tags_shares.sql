CREATE TABLE IF NOT EXISTS note_tags (
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY(note_id, tag)
);
CREATE INDEX IF NOT EXISTS note_tags_tag_idx ON note_tags (tag);

CREATE TABLE IF NOT EXISTS note_shares (
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(note_id, user_id)
);
CREATE INDEX IF NOT EXISTS note_shares_user_idx ON note_shares (user_id);
