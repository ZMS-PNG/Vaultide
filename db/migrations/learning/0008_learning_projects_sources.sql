CREATE TABLE IF NOT EXISTS learning_projects (
  id text PRIMARY KEY CHECK (id ~ '^prj_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  vault_binding_id text NOT NULL,
  kind text NOT NULL CHECK (
    char_length(kind) BETWEEN 2 AND 40
    AND kind ~ '^[a-z][a-z0-9-]+$'
  ),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  root_path text NOT NULL CHECK (char_length(root_path) <= 1024),
  binding_key_hash text NOT NULL CHECK (binding_key_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  binding_revision bigint NOT NULL DEFAULT 1 CHECK (binding_revision >= 1),
  project_revision bigint NOT NULL DEFAULT 0 CHECK (project_revision >= 0),
  latest_manifest_hash text CHECK (
    latest_manifest_hash IS NULL OR latest_manifest_hash ~ '^[a-f0-9]{64}$'
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  last_indexed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, id, vault_binding_id),
  UNIQUE (owner_id, vault_binding_id, binding_key_hash),
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS learning_projects_owner_status_updated_idx
  ON learning_projects(owner_id, status, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS learning_projects_vault_updated_idx
  ON learning_projects(owner_id, vault_binding_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS learning_sources (
  id text PRIMARY KEY CHECK (id ~ '^sou_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  vault_binding_id text NOT NULL,
  origin text NOT NULL CHECK (
    origin IN ('obsidian', 'web', 'pdf', 'github', 'arxiv', 'manual')
  ),
  identity_key_hash text NOT NULL CHECK (identity_key_hash ~ '^[a-f0-9]{64}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  mime_type text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 255),
  status text NOT NULL CHECK (status IN ('active', 'removed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, id, vault_binding_id),
  UNIQUE (owner_id, vault_binding_id, origin, identity_key_hash),
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS learning_sources_vault_updated_idx
  ON learning_sources(owner_id, vault_binding_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS learning_source_versions (
  id text PRIMARY KEY CHECK (id ~ '^svr_[a-f0-9]{32}$'),
  revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  source_id text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  mime_type text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 255),
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  locator jsonb NOT NULL CHECK (jsonb_typeof(locator) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  source_mtime timestamptz,
  observed_bundle_revision bigint NOT NULL CHECK (observed_bundle_revision >= 1),
  observed_project_revision bigint NOT NULL CHECK (observed_project_revision >= 1),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  UNIQUE (owner_id, source_id, id),
  UNIQUE (owner_id, source_id, content_hash),
  FOREIGN KEY (owner_id, source_id)
    REFERENCES learning_sources(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS learning_source_versions_source_revision_idx
  ON learning_source_versions(owner_id, source_id, revision DESC);

CREATE TABLE IF NOT EXISTS learning_project_sources (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  project_id text NOT NULL,
  vault_binding_id text NOT NULL,
  source_id text NOT NULL,
  latest_version_id text NOT NULL,
  first_seen_bundle_id text NOT NULL,
  last_seen_bundle_id text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  removed_at timestamptz,
  PRIMARY KEY (owner_id, project_id, source_id),
  FOREIGN KEY (owner_id, project_id, vault_binding_id)
    REFERENCES learning_projects(owner_id, id, vault_binding_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_id, vault_binding_id)
    REFERENCES learning_sources(owner_id, id, vault_binding_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_id, latest_version_id)
    REFERENCES learning_source_versions(owner_id, source_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS learning_project_sources_active_project_idx
  ON learning_project_sources(owner_id, project_id, last_seen_at DESC, source_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS learning_project_sources_active_source_idx
  ON learning_project_sources(owner_id, source_id, project_id)
  WHERE removed_at IS NULL;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS project_coverage text;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS expected_project_revision bigint;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS base_manifest_hash text;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS bundle_revision bigint;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS project_indexed_at timestamptz;

ALTER TABLE source_uploads
  ADD CONSTRAINT source_uploads_project_context_check CHECK (
    (
      project_id IS NULL
      AND project_coverage IS NULL
      AND expected_project_revision IS NULL
      AND base_manifest_hash IS NULL
      AND bundle_revision IS NULL
      AND project_indexed_at IS NULL
    )
    OR
    (
      project_id IS NOT NULL
      AND project_coverage IN ('partial', 'complete')
      AND expected_project_revision >= 0
      AND (base_manifest_hash IS NULL OR base_manifest_hash ~ '^[a-f0-9]{64}$')
      AND (bundle_revision IS NULL OR bundle_revision >= 1)
    )
  );

ALTER TABLE source_uploads
  ADD CONSTRAINT source_uploads_owner_id_uq UNIQUE (owner_id, id);

ALTER TABLE source_uploads
  ADD CONSTRAINT source_uploads_owner_id_vault_project_uq
  UNIQUE (owner_id, id, vault_binding_id, project_id);

ALTER TABLE source_uploads
  ADD CONSTRAINT source_uploads_project_fk
  FOREIGN KEY (owner_id, project_id)
  REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS source_uploads_project_created_idx
  ON source_uploads(owner_id, project_id, created_at DESC, id)
  WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS source_bundle_items (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  source_bundle_id text NOT NULL,
  project_id text NOT NULL,
  vault_binding_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  snapshot_id text NOT NULL CHECK (snapshot_id ~ '^snp_[a-f0-9]{32}$'),
  source_id text NOT NULL CHECK (source_id ~ '^sou_[a-f0-9]{32}$'),
  source_version_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, source_bundle_id, ordinal),
  UNIQUE (owner_id, source_bundle_id, snapshot_id),
  UNIQUE (owner_id, source_bundle_id, source_id),
  FOREIGN KEY (owner_id, source_bundle_id, vault_binding_id, project_id)
    REFERENCES source_uploads(owner_id, id, vault_binding_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, project_id, source_id)
    REFERENCES learning_project_sources(owner_id, project_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_id, source_version_id)
    REFERENCES learning_source_versions(owner_id, source_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS source_bundle_items_source_version_idx
  ON source_bundle_items(owner_id, source_id, source_version_id);
