-- Periodic synthesis is an explicit, owner-scoped state machine. A schedule
-- never implies direct filesystem access: it creates durable web snapshots;
-- Obsidian writeback remains a separately reviewed local action.
CREATE TABLE IF NOT EXISTS synthesis_schedules (
  id text PRIMARY KEY CHECK (id ~ '^sch_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  period_kind text NOT NULL CHECK (period_kind IN ('daily', 'weekly', 'monthly', 'custom')),
  interval_minutes integer NOT NULL DEFAULT 0 CHECK (interval_minutes BETWEEN 0 AND 525600),
  timezone text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND 80),
  mode text NOT NULL CHECK (mode IN ('timeline', 'domain', 'combined')),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  next_run_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_synthesis_id text,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 2000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, scope_hash, period_kind, interval_minutes),
  CHECK (
    (period_kind = 'custom' AND interval_minutes >= 15)
    OR (period_kind <> 'custom' AND interval_minutes = 0)
  )
);

CREATE INDEX IF NOT EXISTS synthesis_schedules_due_idx
  ON synthesis_schedules(owner_id, next_run_at ASC)
  WHERE status = 'active';

ALTER TABLE synthesis_runs
  ADD COLUMN IF NOT EXISTS schedule_id text;

ALTER TABLE synthesis_runs
  ADD COLUMN IF NOT EXISTS baseline_synthesis_id text;

ALTER TABLE synthesis_runs
  ADD COLUMN IF NOT EXISTS incremental boolean NOT NULL DEFAULT false;

ALTER TABLE synthesis_runs
  ADD COLUMN IF NOT EXISTS evidence_manifest jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(evidence_manifest) = 'array');

ALTER TABLE synthesis_runs
  ADD COLUMN IF NOT EXISTS delta jsonb
  CHECK (delta IS NULL OR jsonb_typeof(delta) = 'object');

ALTER TABLE synthesis_runs
  ADD COLUMN IF NOT EXISTS task_candidates jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(task_candidates) = 'array');

ALTER TABLE synthesis_schedules
  ADD CONSTRAINT synthesis_schedules_last_synthesis_fk
  FOREIGN KEY (owner_id, last_synthesis_id)
  REFERENCES synthesis_runs(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE synthesis_runs
  ADD CONSTRAINT synthesis_runs_schedule_fk
  FOREIGN KEY (owner_id, schedule_id)
  REFERENCES synthesis_schedules(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE synthesis_runs
  ADD CONSTRAINT synthesis_runs_baseline_fk
  FOREIGN KEY (owner_id, baseline_synthesis_id)
  REFERENCES synthesis_runs(owner_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS synthesis_runs_schedule_created_idx
  ON synthesis_runs(owner_id, schedule_id, created_at DESC)
  WHERE schedule_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS synthesis_schedule_runs (
  id text PRIMARY KEY CHECK (id ~ '^ssr_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  schedule_id text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'succeeded', 'skipped', 'failed')),
  synthesis_id text,
  baseline_synthesis_id text,
  evidence_manifest jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_manifest) = 'array'),
  error_detail text CHECK (error_detail IS NULL OR char_length(error_detail) <= 2000),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, schedule_id, scheduled_for),
  FOREIGN KEY (owner_id, schedule_id)
    REFERENCES synthesis_schedules(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, synthesis_id)
    REFERENCES synthesis_runs(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, baseline_synthesis_id)
    REFERENCES synthesis_runs(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS synthesis_schedule_runs_owner_schedule_idx
  ON synthesis_schedule_runs(owner_id, schedule_id, scheduled_for DESC);
