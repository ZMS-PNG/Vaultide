-- Move the complete course lifecycle onto Vercel Workflow while retaining the
-- Neon business ledger as the canonical source of truth.  Workflow owns
-- scheduling/retry; these columns make that execution observable and link it
-- to the already-durable planning and generation records.

ALTER TABLE course_planning_runs
  ADD COLUMN IF NOT EXISTS workflow_run_id text,
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS workflow_phase text NOT NULL DEFAULT 'preflight',
  ADD COLUMN IF NOT EXISTS workflow_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS workflow_completed_at timestamptz;

ALTER TABLE course_planning_runs
  DROP CONSTRAINT IF EXISTS course_planning_runs_workflow_status_check;

ALTER TABLE course_planning_runs
  ADD CONSTRAINT course_planning_runs_workflow_status_check CHECK (
    workflow_status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  );

ALTER TABLE course_planning_runs
  DROP CONSTRAINT IF EXISTS course_planning_runs_workflow_phase_check;

ALTER TABLE course_planning_runs
  ADD CONSTRAINT course_planning_runs_workflow_phase_check CHECK (
    workflow_phase IN (
      'preflight', 'research', 'outline', 'content', 'actions', 'release',
      'completed', 'failed'
    )
  );

ALTER TABLE course_planning_runs
  DROP CONSTRAINT IF EXISTS course_planning_runs_workflow_run_id_check;

ALTER TABLE course_planning_runs
  ADD CONSTRAINT course_planning_runs_workflow_run_id_check CHECK (
    workflow_run_id IS NULL OR char_length(workflow_run_id) BETWEEN 8 AND 240
  );

UPDATE course_planning_runs
SET workflow_status = CASE
      WHEN status IN ('ready', 'consumed') THEN 'completed'
      WHEN status IN ('failed', 'cancelled') THEN 'failed'
      ELSE workflow_status
    END,
    workflow_phase = CASE
      WHEN status IN ('ready', 'consumed') THEN 'completed'
      WHEN status IN ('failed', 'cancelled') THEN 'failed'
      WHEN status = 'outlining' THEN 'outline'
      ELSE workflow_phase
    END,
    workflow_completed_at = CASE
      WHEN status IN ('ready', 'consumed', 'failed', 'cancelled')
        THEN COALESCE(workflow_completed_at, completed_at, updated_at)
      ELSE workflow_completed_at
    END;

CREATE UNIQUE INDEX IF NOT EXISTS course_planning_runs_workflow_run_unique_idx
  ON course_planning_runs(workflow_run_id)
  WHERE workflow_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS course_planning_runs_workflow_recovery_idx
  ON course_planning_runs(owner_id, workflow_status, workflow_phase, updated_at DESC);
