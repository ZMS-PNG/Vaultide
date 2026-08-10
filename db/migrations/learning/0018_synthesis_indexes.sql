-- A synthesis index is the single mutable overview for one schedule. Its
-- individual snapshots remain immutable and are never overwritten.
CREATE TABLE IF NOT EXISTS synthesis_indexes (
  id text PRIMARY KEY CHECK (id ~ '^sdx_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  schedule_id text NOT NULL,
  vault_binding_id text NOT NULL,
  relative_path text NOT NULL CHECK (
    char_length(relative_path) BETWEEN 1 AND 512
    AND relative_path ~ '\.md$'
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  managed_blocks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(managed_blocks) = 'array'),
  last_content_hash text CHECK (
    last_content_hash IS NULL OR last_content_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, schedule_id, vault_binding_id),
  FOREIGN KEY (owner_id, schedule_id)
    REFERENCES synthesis_schedules(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS synthesis_indexes_owner_updated_idx
  ON synthesis_indexes(owner_id, updated_at DESC)
  WHERE status = 'active';

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS synthesis_index_id text;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_synthesis_index_fk
  FOREIGN KEY (owner_id, synthesis_index_id)
  REFERENCES synthesis_indexes(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_operation_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_operation_check
  CHECK (operation IN (
    'createManagedNote',
    'replaceManagedBlocks',
    'replaceProjectIndexBlocks',
    'replaceSynthesisIndexBlocks'
  ));

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_companion_operation_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_companion_operation_check
  CHECK (
    operation = 'createManagedNote'
    OR (
      operation = 'replaceManagedBlocks'
      AND companion_id IS NOT NULL
      AND project_index_id IS NULL
      AND synthesis_index_id IS NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
    OR (
      operation = 'replaceProjectIndexBlocks'
      AND companion_id IS NULL
      AND project_index_id IS NOT NULL
      AND synthesis_index_id IS NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
    OR (
      operation = 'replaceSynthesisIndexBlocks'
      AND companion_id IS NULL
      AND project_index_id IS NULL
      AND synthesis_index_id IS NOT NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
  );

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_context_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_context_check CHECK (
    (draft_kind = 'learning-summary' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NULL)
    OR
    (draft_kind = 'synthesis' AND sprint_id IS NULL AND synthesis_run_id IS NOT NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NULL)
    OR
    (draft_kind = 'external-card' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NOT NULL AND knowledge_asset_version_id IS NOT NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NULL)
    OR
    (draft_kind = 'project-index' AND sprint_id IS NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NOT NULL AND synthesis_index_id IS NULL)
    OR
    (draft_kind = 'synthesis-index' AND sprint_id IS NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS writeback_drafts_synthesis_index_created_idx
  ON writeback_drafts(owner_id, synthesis_index_id, created_at DESC)
  WHERE synthesis_index_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS writeback_drafts_open_synthesis_index_unique_idx
  ON writeback_drafts(owner_id, synthesis_index_id)
  WHERE draft_kind = 'synthesis-index' AND status IN ('generated', 'edited', 'approved');
