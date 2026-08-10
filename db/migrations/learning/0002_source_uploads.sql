CREATE TABLE IF NOT EXISTS source_uploads (
  id text PRIMARY KEY CHECK (id ~ '^src_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  device_id text NOT NULL,
  vault_binding_id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  blob_pathname text NOT NULL UNIQUE CHECK (char_length(blob_pathname) BETWEEN 1 AND 512),
  blob_url text,
  source_byte_size integer NOT NULL CHECK (source_byte_size >= 0),
  archive_byte_size integer CHECK (archive_byte_size >= 0),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 50),
  retention_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'validated', 'rejected', 'deleted')),
  failure_code text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  deleted_at timestamptz,
  FOREIGN KEY (owner_id, device_id)
    REFERENCES integration_devices(owner_id, device_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS source_uploads_owner_created_idx
  ON source_uploads(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS source_uploads_retention_idx
  ON source_uploads(retention_until)
  WHERE status = 'validated';
