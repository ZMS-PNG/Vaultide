-- A companion is the one mutable Vaultide note bound to one user-owned
-- Obsidian source. The original source remains outside this table's write
-- scope and is never targeted by a writeback command.
CREATE TABLE IF NOT EXISTS learning_companions (
  id text PRIMARY KEY CHECK (id ~ '^cmp_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  vault_binding_id text NOT NULL,
  source_id text NOT NULL CHECK (source_id ~ '^sou_[a-f0-9]{32}$'),
  source_bundle_id text,
  source_snapshot_id text CHECK (
    source_snapshot_id IS NULL OR source_snapshot_id ~ '^snp_[a-f0-9]{32}$'
  ),
  project_id text,
  original_relative_path text NOT NULL CHECK (
    char_length(original_relative_path) BETWEEN 1 AND 1024
  ),
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
  UNIQUE (owner_id, vault_binding_id, source_id),
  UNIQUE (owner_id, vault_binding_id, relative_path),
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_bundle_id)
    REFERENCES source_uploads(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, project_id)
    REFERENCES learning_projects(owner_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS learning_companions_owner_updated_idx
  ON learning_companions(owner_id, updated_at DESC);

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS companion_id text;

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS managed_blocks jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(managed_blocks) = 'array');

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_operation_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_operation_check
  CHECK (operation IN ('createManagedNote', 'replaceManagedBlocks'));

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_companion_fk
  FOREIGN KEY (owner_id, companion_id)
  REFERENCES learning_companions(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_companion_operation_check
  CHECK (
    operation = 'createManagedNote'
    OR (
      operation = 'replaceManagedBlocks'
      AND companion_id IS NOT NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
  );

CREATE INDEX IF NOT EXISTS writeback_drafts_companion_created_idx
  ON writeback_drafts(owner_id, companion_id, created_at DESC)
  WHERE companion_id IS NOT NULL;
