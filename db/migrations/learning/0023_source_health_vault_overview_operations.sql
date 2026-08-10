-- External citations keep their immutable retrieval metadata while gaining a
-- separately refreshable link-health projection. "Unreachable" never deletes
-- or rewrites the historical citation.
ALTER TABLE research_sources
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'unverified';

ALTER TABLE research_sources
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

ALTER TABLE research_sources
  ADD COLUMN IF NOT EXISTS http_status integer;

ALTER TABLE research_sources
  ADD COLUMN IF NOT EXISTS final_url text;

ALTER TABLE research_sources
  ADD COLUMN IF NOT EXISTS health_error text;

ALTER TABLE research_sources
  DROP CONSTRAINT IF EXISTS research_sources_availability_check;

ALTER TABLE research_sources
  ADD CONSTRAINT research_sources_availability_check
  CHECK (availability IN ('unverified', 'available', 'redirected', 'unreachable', 'unsafe'));

ALTER TABLE research_sources
  DROP CONSTRAINT IF EXISTS research_sources_http_status_check;

ALTER TABLE research_sources
  ADD CONSTRAINT research_sources_http_status_check
  CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599));

ALTER TABLE research_sources
  DROP CONSTRAINT IF EXISTS research_sources_final_url_check;

ALTER TABLE research_sources
  ADD CONSTRAINT research_sources_final_url_check
  CHECK (final_url IS NULL OR char_length(final_url) <= 4096);

ALTER TABLE research_sources
  DROP CONSTRAINT IF EXISTS research_sources_health_error_check;

ALTER TABLE research_sources
  ADD CONSTRAINT research_sources_health_error_check
  CHECK (health_error IS NULL OR char_length(health_error) <= 160);

CREATE INDEX IF NOT EXISTS research_sources_owner_health_idx
  ON research_sources(owner_id, availability, checked_at DESC);

-- There is exactly one stable, Vaultide-owned top-level overview per paired
-- Vault. It is not an original note and only marked blocks are replaceable.
CREATE TABLE IF NOT EXISTS vault_overviews (
  id text PRIMARY KEY CHECK (id ~ '^vdx_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
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
  UNIQUE (owner_id, vault_binding_id),
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS vault_overviews_owner_updated_idx
  ON vault_overviews(owner_id, updated_at DESC)
  WHERE status = 'active';

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS vault_overview_id text;

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_vault_overview_fk;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_vault_overview_fk
  FOREIGN KEY (owner_id, vault_overview_id)
  REFERENCES vault_overviews(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_operation_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_operation_check
  CHECK (operation IN (
    'createManagedNote',
    'replaceManagedBlocks',
    'replaceProjectIndexBlocks',
    'replaceSynthesisIndexBlocks',
    'replaceVaultOverviewBlocks'
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
      AND vault_overview_id IS NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
    OR (
      operation = 'replaceProjectIndexBlocks'
      AND companion_id IS NULL
      AND project_index_id IS NOT NULL
      AND synthesis_index_id IS NULL
      AND vault_overview_id IS NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
    OR (
      operation = 'replaceSynthesisIndexBlocks'
      AND companion_id IS NULL
      AND project_index_id IS NULL
      AND synthesis_index_id IS NOT NULL
      AND vault_overview_id IS NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
    OR (
      operation = 'replaceVaultOverviewBlocks'
      AND companion_id IS NULL
      AND project_index_id IS NULL
      AND synthesis_index_id IS NULL
      AND vault_overview_id IS NOT NULL
      AND jsonb_array_length(managed_blocks) > 0
    )
  );

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_context_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_context_check CHECK (
    (draft_kind = 'learning-summary' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NULL AND vault_overview_id IS NULL)
    OR
    (draft_kind = 'synthesis' AND sprint_id IS NULL AND synthesis_run_id IS NOT NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NULL AND vault_overview_id IS NULL)
    OR
    (draft_kind = 'external-card' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NOT NULL AND knowledge_asset_version_id IS NOT NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NULL AND vault_overview_id IS NULL)
    OR
    (draft_kind = 'project-index' AND sprint_id IS NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NOT NULL AND synthesis_index_id IS NULL AND vault_overview_id IS NULL)
    OR
    (draft_kind = 'synthesis-index' AND sprint_id IS NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NOT NULL AND vault_overview_id IS NULL)
    OR
    (draft_kind = 'vault-overview' AND sprint_id IS NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL
      AND project_index_id IS NULL AND synthesis_index_id IS NULL AND vault_overview_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS writeback_drafts_vault_overview_created_idx
  ON writeback_drafts(owner_id, vault_overview_id, created_at DESC)
  WHERE vault_overview_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS writeback_drafts_open_vault_overview_unique_idx
  ON writeback_drafts(owner_id, vault_overview_id)
  WHERE draft_kind = 'vault-overview' AND status IN ('generated', 'edited', 'approved');

-- Generation jobs use ephemeral files on Vercel, so their terminal state must
-- also be projected into durable learning operations for diagnosis.
CREATE TABLE IF NOT EXISTS learning_operation_events (
  id text PRIMARY KEY CHECK (id ~ '^ope_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  operation_kind text NOT NULL CHECK (operation_kind IN (
    'classroom-generation', 'synthesis-generation', 'writeback', 'source-verification'
  )),
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 1 AND 160),
  state text NOT NULL CHECK (state IN ('started', 'succeeded', 'failed')),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 160),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS learning_operation_events_owner_kind_time_idx
  ON learning_operation_events(owner_id, operation_kind, occurred_at DESC);

CREATE INDEX IF NOT EXISTS learning_operation_events_owner_operation_idx
  ON learning_operation_events(owner_id, operation_kind, operation_id, occurred_at DESC);
