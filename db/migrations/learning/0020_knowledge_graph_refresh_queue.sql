-- Durable, idempotent invalidation queue for incrementally rebuilding only
-- current knowledge graph projections affected by new learning evidence.
CREATE TABLE IF NOT EXISTS knowledge_graph_refresh_requests (
  id text PRIMARY KEY CHECK (id ~ '^kgq_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  trigger_kind text NOT NULL CHECK (trigger_kind IN (
    'learning-event', 'source-version', 'writeback-receipt', 'synthesis'
  )),
  trigger_id text NOT NULL CHECK (char_length(trigger_id) BETWEEN 1 AND 320),
  classroom_id text,
  project_id text,
  synthesis_id text,
  source_version_id text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'processing', 'succeeded', 'skipped', 'failed'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  error_detail text CHECK (error_detail IS NULL OR char_length(error_detail) <= 2000),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, dedupe_key),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, synthesis_id)
    REFERENCES synthesis_runs(owner_id, id) ON DELETE RESTRICT,
  CHECK (
    classroom_id IS NOT NULL
    OR project_id IS NOT NULL
    OR synthesis_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS knowledge_graph_refresh_pending_idx
  ON knowledge_graph_refresh_requests(owner_id, available_at ASC, created_at ASC)
  WHERE state IN ('pending', 'failed', 'processing') AND attempt_count < 5;

CREATE INDEX IF NOT EXISTS knowledge_graph_refresh_scope_idx
  ON knowledge_graph_refresh_requests(
    owner_id, classroom_id, project_id, synthesis_id, created_at DESC
  );
