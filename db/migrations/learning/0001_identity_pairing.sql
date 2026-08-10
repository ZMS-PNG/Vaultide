CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS learning_owners (
  id text PRIMARY KEY CHECK (id ~ '^own_[a-f0-9]{32}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_devices (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  device_id text NOT NULL CHECK (device_id ~ '^dev_[a-f0-9]{32}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  plugin_version text NOT NULL CHECK (char_length(plugin_version) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (owner_id, device_id)
);

CREATE TABLE IF NOT EXISTS vault_bindings (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  vault_binding_id text NOT NULL CHECK (vault_binding_id ~ '^vlt_[a-f0-9]{32}$'),
  device_id text NOT NULL,
  vault_name text NOT NULL CHECK (char_length(vault_name) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (owner_id, vault_binding_id),
  FOREIGN KEY (owner_id, device_id)
    REFERENCES integration_devices(owner_id, device_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pairing_sessions (
  id text PRIMARY KEY CHECK (id ~ '^prs_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  code_digest text NOT NULL CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  consumed_at timestamptz,
  consumed_by_device_id text,
  invalidated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS pairing_sessions_active_code_digest_uq
  ON pairing_sessions(code_digest)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS pairing_sessions_owner_created_idx
  ON pairing_sessions(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pairing_rate_limits (
  rate_key text PRIMARY KEY CHECK (rate_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 1),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_tokens (
  id text PRIMARY KEY CHECK (id ~ '^tok_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  device_id text NOT NULL,
  vault_binding_id text NOT NULL,
  access_token_digest text NOT NULL UNIQUE CHECK (access_token_digest ~ '^[a-f0-9]{64}$'),
  access_expires_at timestamptz NOT NULL,
  refresh_token_digest text NOT NULL UNIQUE CHECK (refresh_token_digest ~ '^[a-f0-9]{64}$'),
  refresh_expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL CHECK (cardinality(scopes) > 0),
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  UNIQUE (owner_id, device_id, vault_binding_id),
  FOREIGN KEY (owner_id, device_id)
    REFERENCES integration_devices(owner_id, device_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT,
  CHECK (access_expires_at > created_at),
  CHECK (refresh_expires_at > access_expires_at)
);

CREATE INDEX IF NOT EXISTS integration_tokens_access_lookup_idx
  ON integration_tokens(access_token_digest)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS learning_audit_events (
  id text PRIMARY KEY CHECK (id ~ '^aud_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  device_id text,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS learning_audit_events_owner_created_idx
  ON learning_audit_events(owner_id, created_at DESC);
