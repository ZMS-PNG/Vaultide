-- Persist the complete, reviewed planning input before the first outline LLM
-- call.  Planning is therefore addressable, resumable, and auditable instead
-- of living only in one browser tab.

CREATE TABLE IF NOT EXISTS course_planning_runs (
  id text PRIMARY KEY CHECK (id ~ '^cpl_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  session_id text NOT NULL,
  context_pack_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 160),
  status text NOT NULL CHECK (
    status IN ('frozen', 'outlining', 'ready', 'failed', 'consumed', 'cancelled')
  ),
  source_mode text NOT NULL CHECK (source_mode IN ('external', 'obsidian', 'hybrid')),
  requirements_json jsonb NOT NULL CHECK (jsonb_typeof(requirements_json) = 'object'),
  source_references_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_references_json) = 'array'),
  document_text text NOT NULL DEFAULT '' CHECK (char_length(document_text) <= 1200000),
  research_text text NOT NULL DEFAULT '' CHECK (char_length(research_text) <= 800000),
  source_context_expected_chars integer NOT NULL DEFAULT 0
    CHECK (source_context_expected_chars BETWEEN 0 AND 2000000),
  preflight_json jsonb NOT NULL CHECK (jsonb_typeof(preflight_json) = 'object'),
  outline_json jsonb CHECK (outline_json IS NULL OR jsonb_typeof(outline_json) = 'array'),
  language_directive text,
  course_title text,
  task_engine_mode boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (owner_id, session_id)
    REFERENCES learning_sessions(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, context_pack_id)
    REFERENCES learning_context_packs(owner_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, session_id)
);

CREATE INDEX IF NOT EXISTS course_planning_runs_owner_status_idx
  ON course_planning_runs(owner_id, status, updated_at DESC);

ALTER TABLE course_generation_jobs
  ADD COLUMN IF NOT EXISTS planning_run_id text;

ALTER TABLE course_generation_jobs
  DROP CONSTRAINT IF EXISTS course_generation_jobs_planning_run_fk;

ALTER TABLE course_generation_jobs
  ADD CONSTRAINT course_generation_jobs_planning_run_fk
  FOREIGN KEY (owner_id, planning_run_id)
  REFERENCES course_planning_runs(owner_id, id) ON DELETE NO ACTION;

CREATE UNIQUE INDEX IF NOT EXISTS course_generation_jobs_planning_run_unique_idx
  ON course_generation_jobs(owner_id, planning_run_id)
  WHERE planning_run_id IS NOT NULL;
