-- Durable identities for external learning material.  A source version is
-- immutable: a later Git commit, paper revision, or changed article creates a
-- new version instead of overwriting prior evidence.
CREATE TABLE IF NOT EXISTS knowledge_assets (
  id text PRIMARY KEY CHECK (id ~ '^kas_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  asset_kind text NOT NULL CHECK (asset_kind IN ('external-card', 'project-index', 'synthesis-index')),
  source_kind text NOT NULL CHECK (source_kind IN ('github', 'paper', 'article', 'web')),
  canonical_key text NOT NULL CHECK (char_length(canonical_key) BETWEEN 3 AND 1024),
  canonical_url text NOT NULL CHECK (char_length(canonical_url) BETWEEN 8 AND 4096),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, asset_kind, canonical_key)
);

CREATE INDEX IF NOT EXISTS knowledge_assets_owner_kind_updated_idx
  ON knowledge_assets(owner_id, asset_kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_asset_versions (
  id text PRIMARY KEY CHECK (id ~ '^kav_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  asset_id text NOT NULL,
  research_run_id text,
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  card_markdown text NOT NULL CHECK (char_length(card_markdown) BETWEEN 1 AND 500000),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, asset_id, source_fingerprint),
  FOREIGN KEY (owner_id, asset_id)
    REFERENCES knowledge_assets(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, research_run_id)
    REFERENCES research_runs(owner_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS knowledge_asset_versions_asset_captured_idx
  ON knowledge_asset_versions(owner_id, asset_id, captured_at DESC);

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS knowledge_asset_id text;

ALTER TABLE writeback_drafts
  ADD COLUMN IF NOT EXISTS knowledge_asset_version_id text;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_asset_fk
  FOREIGN KEY (owner_id, knowledge_asset_id)
  REFERENCES knowledge_assets(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_asset_version_fk
  FOREIGN KEY (owner_id, knowledge_asset_version_id)
  REFERENCES knowledge_asset_versions(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE writeback_drafts
  DROP CONSTRAINT IF EXISTS writeback_drafts_context_check;

ALTER TABLE writeback_drafts
  ADD CONSTRAINT writeback_drafts_context_check CHECK (
    (draft_kind = 'learning-summary' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL)
    OR
    (draft_kind = 'synthesis' AND sprint_id IS NULL AND synthesis_run_id IS NOT NULL
      AND knowledge_asset_id IS NULL AND knowledge_asset_version_id IS NULL)
    OR
    (draft_kind = 'external-card' AND sprint_id IS NOT NULL AND synthesis_run_id IS NULL
      AND knowledge_asset_id IS NOT NULL AND knowledge_asset_version_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS writeback_drafts_open_asset_version_unique_idx
  ON writeback_drafts(owner_id, knowledge_asset_version_id)
  WHERE draft_kind = 'external-card' AND status IN ('generated', 'edited', 'approved');
