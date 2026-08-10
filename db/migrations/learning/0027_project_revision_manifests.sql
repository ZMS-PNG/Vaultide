-- Immutable project revisions. A project revision is not just a counter: it is
-- the exact set of source versions that formed the canonical learning basis.

CREATE TABLE IF NOT EXISTS project_revision_manifests (
  id text PRIMARY KEY CHECK (id ~ '^prm_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  project_id text NOT NULL,
  project_revision bigint NOT NULL CHECK (project_revision >= 1),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  source_count integer NOT NULL CHECK (source_count >= 0),
  source_bundle_id text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, project_id)
    REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_bundle_id)
    REFERENCES source_uploads(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, project_id, project_revision),
  UNIQUE (owner_id, project_id, manifest_sha256),
  UNIQUE (owner_id, id)
);

CREATE TABLE IF NOT EXISTS project_revision_manifest_entries (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  manifest_id text NOT NULL,
  project_id text NOT NULL,
  source_id text NOT NULL,
  source_version_id text NOT NULL,
  relative_path text NOT NULL CHECK (char_length(relative_path) BETWEEN 1 AND 1024),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  source_mtime timestamptz,
  PRIMARY KEY (owner_id, manifest_id, source_id),
  FOREIGN KEY (owner_id, manifest_id)
    REFERENCES project_revision_manifests(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, project_id)
    REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_id, source_version_id)
    REFERENCES learning_source_versions(owner_id, source_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS project_revision_manifest_entries_project_idx
  ON project_revision_manifest_entries(owner_id, project_id, manifest_id, relative_path);

ALTER TABLE learning_sessions
  ADD COLUMN IF NOT EXISTS project_revision_manifest_id text;

ALTER TABLE learning_sessions
  ADD CONSTRAINT learning_sessions_project_revision_manifest_fk
  FOREIGN KEY (owner_id, project_revision_manifest_id)
  REFERENCES project_revision_manifests(owner_id, id) ON DELETE NO ACTION;
