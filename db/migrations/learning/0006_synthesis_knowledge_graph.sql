CREATE TABLE IF NOT EXISTS synthesis_runs (
  id text PRIMARY KEY CHECK (id ~ '^syn_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('timeline', 'domain', 'combined')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  summary_markdown text NOT NULL CHECK (char_length(summary_markdown) <= 500000),
  graph jsonb NOT NULL CHECK (jsonb_typeof(graph) = 'object'),
  graph_hash text NOT NULL CHECK (graph_hash ~ '^[a-f0-9]{64}$'),
  classroom_count integer NOT NULL CHECK (classroom_count BETWEEN 1 AND 50),
  node_count integer NOT NULL CHECK (node_count BETWEEN 1 AND 2000),
  edge_count integer NOT NULL CHECK (edge_count BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS synthesis_runs_owner_created_idx
  ON synthesis_runs(owner_id, created_at DESC);

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS draft_kind text NOT NULL DEFAULT 'learning-summary';

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS synthesis_run_id text;

ALTER TABLE writeback_drafts
  ALTER COLUMN sprint_id DROP NOT NULL;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_synthesis_run_fk
  FOREIGN KEY (owner_id, synthesis_run_id)
  REFERENCES synthesis_runs(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_context_check CHECK (
    (draft_kind = 'learning-summary' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL)
    OR
    (draft_kind = 'synthesis' AND sprint_id IS NULL AND synthesis_run_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS writeback_drafts_synthesis_created_idx
  ON writeback_drafts(owner_id, synthesis_run_id, created_at DESC)
  WHERE synthesis_run_id IS NOT NULL;
