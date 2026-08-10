-- Deposition automation is deliberately separate from writeback commands. A
-- policy can make a companion eligible for unattended local confirmation, but
-- it can never grant write access to an original Obsidian note.
CREATE TABLE IF NOT EXISTS deposition_policies (
  owner_id text PRIMARY KEY REFERENCES learning_owners(id) ON DELETE RESTRICT,
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'batch', 'managed-auto')),
  managed_auto_enabled boolean NOT NULL DEFAULT false,
  allow_companion_updates boolean NOT NULL DEFAULT false,
  allow_external_cards boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  CHECK (mode <> 'managed-auto' OR managed_auto_enabled = true)
);

CREATE TABLE IF NOT EXISTS deposition_runs (
  id text PRIMARY KEY CHECK (id ~ '^dpr_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  sprint_id text,
  asset_type text NOT NULL CHECK (asset_type IN ('learning-companion', 'learning-summary', 'external-card', 'project-index', 'synthesis')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 512),
  projector_version text NOT NULL CHECK (char_length(projector_version) BETWEEN 1 AND 128),
  state text NOT NULL CHECK (state IN (
    'pending', 'collecting', 'generated', 'policy_checked', 'queued', 'leased',
    'locally_validated', 'applied', 'receipted', 'blocked_missing_source',
    'blocked_policy', 'conflicted', 'expired', 'failed_retryable',
    'failed_terminal', 'cancelled'
  )),
  risk_level text NOT NULL CHECK (risk_level IN ('none', 'low', 'medium', 'high')),
  error_code text,
  error_detail text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, sprint_id)
    REFERENCES learning_sprints(owner_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS deposition_runs_owner_state_updated_idx
  ON deposition_runs(owner_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS deposition_items (
  id text PRIMARY KEY CHECK (id ~ '^dpi_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  run_id text NOT NULL,
  source_version_id text,
  target_kind text NOT NULL CHECK (target_kind IN ('companion', 'managed-note', 'project-index', 'synthesis')),
  target_id text,
  state text NOT NULL CHECK (state IN ('pending', 'generated', 'queued', 'applied', 'conflicted', 'failed', 'skipped')),
  command_risk_level text NOT NULL CHECK (command_risk_level IN ('none', 'low', 'medium', 'high')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, run_id)
    REFERENCES deposition_runs(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS deposition_items_owner_run_state_idx
  ON deposition_items(owner_id, run_id, state);

CREATE UNIQUE INDEX IF NOT EXISTS deposition_items_owner_run_target_unique_idx
  ON deposition_items(owner_id, run_id, target_kind, COALESCE(target_id, ''));
