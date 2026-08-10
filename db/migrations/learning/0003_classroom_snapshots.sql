CREATE TABLE IF NOT EXISTS learning_classrooms (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  classroom_id text NOT NULL CHECK (
    char_length(classroom_id) BETWEEN 1 AND 128
    AND classroom_id ~ '^[a-zA-Z0-9_-]+$'
  ),
  revision bigint NOT NULL CHECK (revision >= 1),
  snapshot_blob_pathname text NOT NULL CHECK (
    char_length(snapshot_blob_pathname) BETWEEN 1 AND 512
  ),
  snapshot_blob_url text NOT NULL CHECK (char_length(snapshot_blob_url) BETWEEN 1 AND 2048),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_byte_size integer NOT NULL CHECK (snapshot_byte_size > 0),
  scene_count integer NOT NULL CHECK (scene_count >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, classroom_id),
  UNIQUE (snapshot_blob_pathname)
);

CREATE INDEX IF NOT EXISTS learning_classrooms_owner_updated_idx
  ON learning_classrooms(owner_id, updated_at DESC);
