-- A project index is a Vaultide-owned aggregate document.  It never aliases
-- a user source note or a learning companion, so its local compare-and-swap
-- identity has an independent prefix and foreign key.
CREATE TABLE IF NOT EXISTS project_learning_indexes (
  id text PRIMARY KEY CHECK (id ~ '^pdx_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  project_id text NOT NULL,
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
  UNIQUE (owner_id, project_id, vault_binding_id),
  FOREIGN KEY (owner_id, project_id, vault_binding_id)
    REFERENCES learning_projects(owner_id, id, vault_binding_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS project_learning_indexes_owner_updated_idx
  ON project_learning_indexes(owner_id, updated_at DESC)
  WHERE status = 'active';

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS project_index_id text;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_project_index_fk
  FOREIGN KEY (owner_id, project_index_id)
  REFERENCES project_learning_indexes(owner_id, id) ON DELETE RESTRICT;

-- A draft records the terminal local writeback outcome as well as its editing
-- states. This releases a successfully receipted project-index draft for the
-- next safe revision without treating a pending approval as disposable.
ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_status_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_status_check
  CHECK (status IN (
    'generated', 'edited', 'approved', 'applied', 'conflicted', 'failed', 'rejected', 'expired'
  ));

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_operation_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_operation_check
  CHECK (operation IN ('createManagedNote', 'replaceManagedBlocks', 'replaceProjectIndexBlocks'));

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
      AND jsonb_array_length(managed_blocks) > 0
    )
    OR (
      operation = 'replaceProjectIndexBlocks'
      AND companion_id IS NULL
      AND project_index_id IS NOT NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
  );

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_context_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_context_check CHECK (
    (draft_kind = 'learning-summary' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL)
    OR
    (draft_kind = 'synthesis' AND sprint_id IS NULL AND synthesis_run_id IS NOT NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL)
    OR
    (draft_kind = 'external-card' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NOT NULL AND knowledge_asset_version_id IS NOT NULL
      AND project_index_id IS NULL)
    OR
    (draft_kind = 'project-index' AND sprint_id IS NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS writeback_drafts_project_index_created_idx
  ON writeback_drafts(owner_id, project_index_id, created_at DESC)
  WHERE project_index_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS writeback_drafts_open_project_index_unique_idx
  ON writeback_drafts(owner_id, project_index_id)
  WHERE draft_kind = 'project-index' AND status IN ('generated', 'edited', 'approved');
