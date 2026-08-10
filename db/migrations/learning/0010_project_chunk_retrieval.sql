CREATE TABLE IF NOT EXISTS learning_source_indexes (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  source_id text NOT NULL,
  source_version_id text NOT NULL,
  index_version text NOT NULL CHECK (index_version IN ('markdown-lexical-v1')),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'purged')),
  source_bundle_id text NOT NULL,
  snapshot_id text NOT NULL CHECK (snapshot_id ~ '^snp_[a-f0-9]{32}$'),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  retention_until timestamptz NOT NULL,
  failure_code text CHECK (
    failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 160
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (owner_id, source_version_id, index_version),
  FOREIGN KEY (owner_id, source_id, source_version_id)
    REFERENCES learning_source_versions(owner_id, source_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_bundle_id)
    REFERENCES source_uploads(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS learning_source_indexes_bundle_status_idx
  ON learning_source_indexes(owner_id, source_bundle_id, status);

CREATE TABLE IF NOT EXISTS learning_source_chunks (
  id text PRIMARY KEY CHECK (id ~ '^chk_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  source_id text NOT NULL,
  source_version_id text NOT NULL,
  index_version text NOT NULL CHECK (index_version IN ('markdown-lexical-v1')),
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  offset_unit text NOT NULL DEFAULT 'utf16' CHECK (offset_unit = 'utf16'),
  start_char integer NOT NULL CHECK (start_char >= 0),
  end_char integer NOT NULL CHECK (end_char >= start_char),
  char_count integer NOT NULL CHECK (char_count = end_char - start_char),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  heading_path jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(heading_path) = 'array'
  ),
  anchor_tokens text NOT NULL CHECK (char_length(anchor_tokens) <= 32768),
  body_tokens text NOT NULL CHECK (char_length(body_tokens) <= 65536),
  token_count integer NOT NULL CHECK (token_count >= 0),
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(anchor_tokens, '')), 'A')
    ||
    setweight(to_tsvector('simple', coalesce(body_tokens, '')), 'B')
  ) STORED,
  redacted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, source_version_id, index_version, ordinal),
  FOREIGN KEY (owner_id, source_id, source_version_id)
    REFERENCES learning_source_versions(owner_id, source_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_version_id, index_version)
    REFERENCES learning_source_indexes(owner_id, source_version_id, index_version)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS learning_source_chunks_search_idx
  ON learning_source_chunks USING GIN (search_document)
  WHERE redacted_at IS NULL;

CREATE INDEX IF NOT EXISTS learning_source_chunks_source_version_idx
  ON learning_source_chunks(owner_id, source_id, source_version_id, index_version, ordinal)
  WHERE redacted_at IS NULL;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS indexed_chunk_count integer;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS chunk_index_status text;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS chunk_index_failure_code text;

ALTER TABLE source_uploads
  ADD COLUMN IF NOT EXISTS chunk_indexed_at timestamptz;

ALTER TABLE source_uploads
  ADD CONSTRAINT source_uploads_indexed_chunk_count_check CHECK (
    indexed_chunk_count IS NULL OR indexed_chunk_count >= 0
  );

ALTER TABLE source_uploads
  ADD CONSTRAINT source_uploads_chunk_index_status_check CHECK (
    chunk_index_status IS NULL
    OR chunk_index_status IN ('pending', 'ready', 'failed', 'purged')
  );

ALTER TABLE source_uploads
  ADD CONSTRAINT source_uploads_chunk_index_failure_code_check CHECK (
    chunk_index_failure_code IS NULL
    OR char_length(chunk_index_failure_code) BETWEEN 1 AND 160
  );

CREATE TABLE IF NOT EXISTS project_retrieval_runs (
  id text PRIMARY KEY CHECK (id ~ '^prr_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  project_id text NOT NULL,
  project_revision bigint NOT NULL CHECK (project_revision >= 1),
  anchor_bundle_id text,
  goal text NOT NULL CHECK (char_length(goal) BETWEEN 1 AND 4000),
  goal_hash text NOT NULL CHECK (goal_hash ~ '^[a-f0-9]{64}$'),
  strategy text NOT NULL CHECK (
    strategy IN ('lexical-diverse-v1')
  ),
  max_context_chars integer NOT NULL CHECK (
    max_context_chars BETWEEN 20000 AND 48000
  ),
  context_char_count integer NOT NULL CHECK (
    context_char_count >= 0 AND context_char_count <= max_context_chars
  ),
  candidate_chunk_count integer NOT NULL CHECK (candidate_chunk_count >= 0),
  selected_chunk_count integer NOT NULL CHECK (selected_chunk_count >= 1),
  selected_source_count integer NOT NULL CHECK (selected_source_count >= 1),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, anchor_bundle_id)
    REFERENCES source_uploads(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS project_retrieval_runs_project_created_idx
  ON project_retrieval_runs(owner_id, project_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS project_retrieval_items (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  retrieval_run_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  citation_id text NOT NULL CHECK (citation_id ~ '^V[1-9][0-9]{0,2}$'),
  source_chunk_id text NOT NULL,
  source_id text NOT NULL,
  source_version_id text NOT NULL,
  source_bundle_id text NOT NULL,
  snapshot_id text NOT NULL CHECK (snapshot_id ~ '^snp_[a-f0-9]{32}$'),
  score double precision NOT NULL CHECK (score >= 0),
  locator_snapshot jsonb NOT NULL CHECK (jsonb_typeof(locator_snapshot) = 'object'),
  quoted_hash text NOT NULL CHECK (quoted_hash ~ '^[a-f0-9]{64}$'),
  selected_char_count integer NOT NULL CHECK (selected_char_count >= 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, retrieval_run_id, ordinal),
  UNIQUE (owner_id, retrieval_run_id, citation_id),
  UNIQUE (owner_id, retrieval_run_id, source_chunk_id),
  FOREIGN KEY (owner_id, retrieval_run_id)
    REFERENCES project_retrieval_runs(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_id, source_version_id)
    REFERENCES learning_source_versions(owner_id, source_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_chunk_id)
    REFERENCES learning_source_chunks(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_bundle_id)
    REFERENCES source_uploads(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS project_retrieval_items_source_idx
  ON project_retrieval_items(owner_id, source_id, source_version_id);

ALTER TABLE learning_sprints
  ADD COLUMN IF NOT EXISTS retrieval_run_id text;

ALTER TABLE learning_sprints
  ADD CONSTRAINT learning_sprints_retrieval_run_fk
  FOREIGN KEY (owner_id, retrieval_run_id)
  REFERENCES project_retrieval_runs(owner_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS learning_sprints_retrieval_run_idx
  ON learning_sprints(owner_id, retrieval_run_id)
  WHERE retrieval_run_id IS NOT NULL;
