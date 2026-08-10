CREATE TABLE IF NOT EXISTS learning_sprints (
  id text PRIMARY KEY CHECK (id ~ '^spr_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  classroom_id text NOT NULL,
  source_bundle_id text REFERENCES source_uploads(id) ON DELETE SET NULL,
  goal text NOT NULL DEFAULT '' CHECK (char_length(goal) <= 8000),
  status text NOT NULL CHECK (status IN ('active', 'completed', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, classroom_id),
  FOREIGN KEY (owner_id, classroom_id)
    REFERENCES learning_classrooms(owner_id, classroom_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS learning_sprints_owner_updated_idx
  ON learning_sprints(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS learning_events (
  server_seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id text NOT NULL UNIQUE CHECK (id ~ '^lev_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  sprint_id text NOT NULL,
  client_event_id text NOT NULL CHECK (char_length(client_event_id) BETWEEN 1 AND 160),
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 1 AND 128),
  event_type text NOT NULL CHECK (event_type IN (
    'diagnosisAnswered', 'retrievalAttempted', 'hintRequested', 'answerRevealed',
    'explanationSubmitted', 'practiceSubmitted', 'feedbackReceived',
    'evidenceSubmitted', 'evidenceEvaluated', 'transferTaskCompleted',
    'writebackApproved', 'writebackApplied', 'reviewCompleted'
  )),
  source text NOT NULL CHECK (source IN ('web', 'obsidian-plugin', 'system', 'import')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  causation_id text,
  correlation_id text,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  FOREIGN KEY (owner_id, sprint_id)
    REFERENCES learning_sprints(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, device_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS learning_events_sprint_seq_idx
  ON learning_events(owner_id, sprint_id, server_seq);

CREATE TABLE IF NOT EXISTS writeback_drafts (
  id text PRIMARY KEY CHECK (id ~ '^wbd_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  sprint_id text NOT NULL,
  target_device_id text NOT NULL,
  target_vault_binding_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('generated', 'edited', 'approved', 'rejected', 'expired')),
  operation text NOT NULL CHECK (operation IN ('createManagedNote')),
  relative_path text NOT NULL CHECK (
    char_length(relative_path) BETWEEN 1 AND 512
    AND relative_path ~ '\.md$'
  ),
  content text NOT NULL CHECK (char_length(content) <= 500000),
  frontmatter jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(frontmatter) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  approved_at timestamptz,
  FOREIGN KEY (owner_id, sprint_id)
    REFERENCES learning_sprints(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, target_device_id)
    REFERENCES integration_devices(owner_id, device_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, target_vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT,
  UNIQUE (id, revision)
);

CREATE INDEX IF NOT EXISTS writeback_drafts_sprint_created_idx
  ON writeback_drafts(owner_id, sprint_id, created_at DESC);

CREATE TABLE IF NOT EXISTS writeback_commands (
  id text PRIMARY KEY CHECK (id ~ '^wbc_[a-f0-9]{32}$'),
  draft_id text NOT NULL,
  draft_revision integer NOT NULL,
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  device_id text NOT NULL,
  vault_binding_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'leased', 'applied', 'conflicted', 'failed', 'expired', 'rejected')
  ),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (draft_id, draft_revision)
    REFERENCES writeback_drafts(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, device_id)
    REFERENCES integration_devices(owner_id, device_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, vault_binding_id)
    REFERENCES vault_bindings(owner_id, vault_binding_id) ON DELETE RESTRICT,
  UNIQUE (draft_id, draft_revision)
);

CREATE INDEX IF NOT EXISTS writeback_commands_device_pending_idx
  ON writeback_commands(owner_id, device_id, vault_binding_id, issued_at)
  WHERE status IN ('pending', 'leased');

CREATE TABLE IF NOT EXISTS writeback_receipts (
  id text PRIMARY KEY CHECK (id ~ '^wbr_[a-f0-9]{32}$'),
  command_id text NOT NULL REFERENCES writeback_commands(id) ON DELETE RESTRICT,
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  device_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied', 'conflicted', 'failed', 'expired', 'rejected')),
  resulting_content_hash text CHECK (
    resulting_content_hash IS NULL OR resulting_content_hash ~ '^[a-f0-9]{64}$'
  ),
  resulting_path text CHECK (resulting_path IS NULL OR char_length(resulting_path) <= 512),
  conflict_detail text CHECK (conflict_detail IS NULL OR char_length(conflict_detail) <= 2000),
  applied_at timestamptz,
  reported_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, device_id)
    REFERENCES integration_devices(owner_id, device_id) ON DELETE RESTRICT,
  UNIQUE (command_id, device_id)
);

CREATE INDEX IF NOT EXISTS writeback_receipts_owner_reported_idx
  ON writeback_receipts(owner_id, reported_at DESC);
