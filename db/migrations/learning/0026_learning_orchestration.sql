-- Durable learning orchestration.  The browser may start and observe a job,
-- but it is never the owner of generation progress or course release.

CREATE TABLE IF NOT EXISTS learning_sessions (
  id text PRIMARY KEY CHECK (id ~ '^lsn_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  goal text NOT NULL CHECK (char_length(goal) BETWEEN 1 AND 8000),
  source_mode text NOT NULL CHECK (source_mode IN ('external', 'obsidian', 'hybrid')),
  status text NOT NULL CHECK (
    status IN ('preparing', 'generating', 'ready', 'learning', 'reviewing', 'completed', 'archived')
  ),
  source_bundle_id text REFERENCES source_uploads(id) ON DELETE SET NULL,
  project_id text,
  retrieval_run_id text,
  current_context_pack_id text,
  current_knowledge_snapshot_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS learning_sessions_owner_updated_idx
  ON learning_sessions(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS learning_knowledge_snapshots (
  id text PRIMARY KEY CHECK (id ~ '^ksn_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  session_id text NOT NULL,
  scope_kind text NOT NULL DEFAULT 'session'
    CHECK (scope_kind IN ('session', 'project', 'source', 'topic')),
  scope_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  parent_snapshot_id text,
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  verified_knowledge jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(verified_knowledge) = 'array'),
  misconceptions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(misconceptions) = 'array'),
  unresolved_items jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(unresolved_items) = 'array'),
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence_summary) = 'object'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, session_id)
    REFERENCES learning_sessions(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, parent_snapshot_id)
    REFERENCES learning_knowledge_snapshots(owner_id, id) ON DELETE NO ACTION,
  UNIQUE (owner_id, session_id, revision),
  UNIQUE (owner_id, scope_kind, scope_id, revision),
  UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS learning_knowledge_snapshots_scope_revision_idx
  ON learning_knowledge_snapshots(owner_id, scope_kind, scope_id, revision DESC);

CREATE TABLE IF NOT EXISTS learning_context_packs (
  id text PRIMARY KEY CHECK (id ~ '^ctx_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  session_id text NOT NULL,
  knowledge_snapshot_id text,
  status text NOT NULL CHECK (status IN ('draft', 'frozen', 'superseded')),
  source_manifest jsonb NOT NULL CHECK (jsonb_typeof(source_manifest) = 'object'),
  source_text text NOT NULL CHECK (char_length(source_text) <= 2000000),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  selected_episodes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(selected_episodes) = 'array'),
  exclusions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(exclusions) = 'array'),
  unresolved_items jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(unresolved_items) = 'array'),
  created_at timestamptz NOT NULL,
  frozen_at timestamptz,
  FOREIGN KEY (owner_id, session_id)
    REFERENCES learning_sessions(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, knowledge_snapshot_id)
    REFERENCES learning_knowledge_snapshots(owner_id, id) ON DELETE NO ACTION,
  UNIQUE (owner_id, id)
);

ALTER TABLE learning_sessions
  ADD CONSTRAINT learning_sessions_context_pack_fk
  FOREIGN KEY (owner_id, current_context_pack_id)
  REFERENCES learning_context_packs(owner_id, id) ON DELETE NO ACTION;

ALTER TABLE learning_sessions
  ADD CONSTRAINT learning_sessions_knowledge_snapshot_fk
  FOREIGN KEY (owner_id, current_knowledge_snapshot_id)
  REFERENCES learning_knowledge_snapshots(owner_id, id) ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS learning_context_packs_session_created_idx
  ON learning_context_packs(owner_id, session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS course_generation_jobs (
  id text PRIMARY KEY CHECK (id ~ '^cgj_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  session_id text NOT NULL,
  context_pack_id text NOT NULL,
  classroom_id text NOT NULL CHECK (char_length(classroom_id) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 160),
  status text NOT NULL CHECK (
    status IN ('queued', 'running', 'verifying', 'ready', 'failed', 'cancelled')
  ),
  current_phase text NOT NULL CHECK (
    current_phase IN ('content', 'actions', 'release', 'completed', 'failed')
  ),
  current_scene_order integer CHECK (current_scene_order IS NULL OR current_scene_order >= 1),
  outline_count integer NOT NULL CHECK (outline_count BETWEEN 9 AND 12),
  scenes_generated integer NOT NULL DEFAULT 0
    CHECK (scenes_generated BETWEEN 0 AND outline_count),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input_json jsonb NOT NULL CHECK (jsonb_typeof(input_json) = 'object'),
  quality_summary jsonb CHECK (
    quality_summary IS NULL OR jsonb_typeof(quality_summary) = 'object'
  ),
  queue_message_id text,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (owner_id, session_id)
    REFERENCES learning_sessions(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, context_pack_id)
    REFERENCES learning_context_packs(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, classroom_id)
);

CREATE INDEX IF NOT EXISTS course_generation_jobs_owner_status_idx
  ON course_generation_jobs(owner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS course_generation_steps (
  id text PRIMARY KEY CHECK (id ~ '^cgs_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  job_id text NOT NULL,
  scene_order integer NOT NULL CHECK (scene_order >= 0),
  phase text NOT NULL CHECK (phase IN ('content', 'actions', 'release')),
  status text NOT NULL CHECK (
    status IN ('pending', 'leased', 'succeeded', 'retryable', 'failed', 'cancelled')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  result_json jsonb CHECK (result_json IS NULL OR jsonb_typeof(result_json) = 'object'),
  quality_json jsonb CHECK (quality_json IS NULL OR jsonb_typeof(quality_json) = 'object'),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (owner_id, job_id)
    REFERENCES course_generation_jobs(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, job_id, scene_order, phase),
  UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS course_generation_steps_runnable_idx
  ON course_generation_steps(owner_id, job_id, status, scene_order, phase);

CREATE TABLE IF NOT EXISTS course_generation_attempts (
  id text PRIMARY KEY CHECK (id ~ '^cga_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  job_id text NOT NULL,
  step_id text NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 10),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'rejected', 'failed')),
  provider_id text,
  model_id text,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  quality_score numeric(5,2),
  error_code text,
  error_detail text,
  usage_json jsonb CHECK (usage_json IS NULL OR jsonb_typeof(usage_json) = 'object'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (owner_id, job_id)
    REFERENCES course_generation_jobs(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, step_id)
    REFERENCES course_generation_steps(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, step_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS course_generation_attempts_job_started_idx
  ON course_generation_attempts(owner_id, job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS course_generation_dispatches (
  id text PRIMARY KEY CHECK (id ~ '^cgd_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  job_id text NOT NULL,
  dispatch_seq integer NOT NULL CHECK (dispatch_seq >= 1),
  status text NOT NULL CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  not_before timestamptz NOT NULL,
  lease_token text,
  lease_expires_at timestamptz,
  queue_message_id text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  FOREIGN KEY (owner_id, job_id)
    REFERENCES course_generation_jobs(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, job_id, dispatch_seq),
  UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS course_generation_dispatches_pending_idx
  ON course_generation_dispatches(owner_id, status, not_before, created_at);

CREATE TABLE IF NOT EXISTS course_releases (
  id text PRIMARY KEY CHECK (id ~ '^crl_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  job_id text NOT NULL,
  classroom_id text NOT NULL,
  release_version integer NOT NULL CHECK (release_version >= 1),
  outline_count integer NOT NULL CHECK (outline_count BETWEEN 9 AND 12),
  scene_count integer NOT NULL CHECK (scene_count = outline_count),
  quality_score numeric(5,2) NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  quality_json jsonb NOT NULL CHECK (jsonb_typeof(quality_json) = 'object'),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, job_id)
    REFERENCES course_generation_jobs(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, job_id),
  UNIQUE (owner_id, classroom_id, release_version),
  UNIQUE (owner_id, id)
);

CREATE TABLE IF NOT EXISTS rumination_cycles (
  id text PRIMARY KEY CHECK (id ~ '^rum_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  session_id text NOT NULL,
  sprint_id text,
  cycle_kind text NOT NULL CHECK (
    cycle_kind IN ('scheduled-recall', 'weak-point-repair', 'transfer', 'full-relearn')
  ),
  status text NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  source_knowledge_snapshot_id text,
  result_knowledge_snapshot_id text,
  selected_concepts jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(selected_concepts) = 'array'),
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence_summary) = 'object'),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (owner_id, session_id)
    REFERENCES learning_sessions(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, sprint_id)
    REFERENCES learning_sprints(owner_id, id) ON DELETE NO ACTION,
  FOREIGN KEY (owner_id, source_knowledge_snapshot_id)
    REFERENCES learning_knowledge_snapshots(owner_id, id) ON DELETE NO ACTION,
  FOREIGN KEY (owner_id, result_knowledge_snapshot_id)
    REFERENCES learning_knowledge_snapshots(owner_id, id) ON DELETE NO ACTION,
  UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS rumination_cycles_session_created_idx
  ON rumination_cycles(owner_id, session_id, created_at DESC);
